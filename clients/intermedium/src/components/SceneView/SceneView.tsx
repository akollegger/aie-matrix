import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DeckGL from "@deck.gl/react";
import { type MapViewState, type Layer, LinearInterpolator, _GlobeView, MapView } from "deck.gl";
import { useClientState } from "../../context/ClientState.js";
import {
  createH3WireframeLayer,
  createHexGridLayer,
} from "../../layers/hexGridLayer.js";
import { createGhostPointCloudLayer } from "../../layers/ghostPointCloudLayer.js";
import { createSelectionH3Layer } from "../../layers/selectionLayer.js";
import {
  createGhostPickLayer,
  ghostDataForPick,
  type GhostPickPoint,
} from "../../layers/ghostPickLayer.js";
import {
  buildIconTileData,
  createTileIconLayer,
} from "../../layers/tileIconLayer.js";
import {
  AREA_DISK_K,
  NEIGHBOR_DISK_K,
  ROOM_RENDER_RADIUS,
  cellDisk,
  tilesInDisk,
} from "../../utils/h3region.js";
import {
  mapViewFromTileBounds,
  areaViewFromFocus,
  neighborView,
  globalView,
  regionalView,
  cellFitViewport,
  voidNeighborH3s,
  centerH3,
  STOP_PITCH,
} from "../../utils/hexViewport.js";
import { getRes0Cells, cellToChildren, cellToParent, cellToLatLng, latLngToCell, isValidCell, polygonToCells, gridDisk, gridDistance } from "h3-js";
import { PARENT_DRILL_MAX } from "../../hooks/useRegionalDrill.js";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { useRegionalDrill, REGIONAL_DRILL_MAX } from "../../hooks/useRegionalDrill.js";
import type { GhostPosition } from "../../types/ghostPosition.js";
import type { WorldTile } from "../../types/worldTile.js";
import type { CameraStop, ViewState } from "../../types/viewState.js";
import { TileTooltip, LandmarkTooltip } from "./TileTooltip.js";

// Controller options (interactions off) for globe-projection stops.
const GLOBE_CONTROLLER_OPTIONS = {
  scrollZoom: false,
  doubleClickZoom: false,
  dragRotate: false,
  touchZoom: false,
  touchRotate: false,
  keyboard: false,
} as const;

// Controller options for interior MapView stops (plan/room/situational).
// All user interactions disabled, but maxZoom raised so TransitionManager can
// animate to R15 street-scale zoom (~24). Previously used false (no controller),
// but without a controller there is no TransitionManager and transitions jump instantly.
const MAP_CONTROLLER_OPTIONS = {
  scrollZoom: false,
  doubleClickZoom: false,
  dragPan: false,
  dragRotate: false,
  touchZoom: false,
  touchRotate: false,
  keyboard: false,
  maxZoom: 26,
} as const;

function isWorldTile(o: unknown): o is WorldTile {
  return (
    typeof o === "object" &&
    o !== null &&
    "h3Index" in o &&
    "tileType" in o &&
    "items" in o
  );
}

function isGhostPickPoint(o: unknown): o is GhostPickPoint {
  return typeof o === "object" && o !== null && "ghostId" in o && "lng" in o;
}

function pickId(o: unknown): string {
  if (isWorldTile(o)) return `h3:${o.h3Index}`;
  if (isGhostPickPoint(o)) return `g:${o.ghostId}`;
  return `x:${String(o)}`;
}

function ghostPickInDisk(
  ghosts: ReadonlyMap<string, GhostPosition>,
  disk: Set<string>,
): GhostPickPoint[] {
  const all = ghostDataForPick(ghosts);
  return all.filter((p) => {
    const g = ghosts.get(p.ghostId);
    return g ? disk.has(g.h3Index) : false;
  });
}

/** Transition duration in ms (FR-028). LOD flip fires at midpoint (TRANSITION_DURATION / 2). */
const TRANSITION_DURATION = 1200;
/** Phase durations for depth-crossing transitions (plan ↔ room ↔ situational). */
const DEPTH_PITCH_DURATION = 500;   // phase 1: tilt only
const DEPTH_ZOOM_DURATION = 1000;   // phase 2: zoom + pan
/** Duration for re-centering focus within Room (double-click pan). */
const ROOM_FOCUS_PAN_DURATION = 2000;

/** Ease-out cubic — decelerates into destination; smoother than in-out for camera moves. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const TRANSITION_INTERPOLATOR = new LinearInterpolator(["longitude", "latitude", "zoom", "pitch", "bearing"]);
const PITCH_INTERPOLATOR = new LinearInterpolator(["pitch"]);

/** Per-cell datum for the expandable mesh and SF fill reveal animation. */
type MeshCell = { readonly h3Index: string; readonly dist: number };

/** Wave-front band width in H3 grid rings — controls reveal softness. */
const WAVE_WIDTH = 4;

/** Opacity for a cell at `dist` rings from venue, given current wave `radius`. */
function waveOpacity(dist: number, radius: number): number {
  if (radius < 0) return 0;
  return Math.max(0, Math.min(1, (radius - dist + WAVE_WIDTH) / WAVE_WIDTH));
}

/** Pickable marker datum — used for venue + landmark H3HexagonLayer. */
type LandmarkMarker = {
  readonly h3Index: string;
  readonly isVenue: boolean;
  readonly name: string;
};
function isLandmarkMarker(o: unknown): o is LandmarkMarker {
  return (
    typeof o === "object" && o !== null &&
    "h3Index" in o && "isVenue" in o && "name" in o &&
    typeof (o as LandmarkMarker).name === "string"
  );
}

/** Curated SF landmarks for Regional stop orientation — venue-anchoring set. */
const SF_LANDMARKS: ReadonlyArray<{ readonly lat: number; readonly lng: number; readonly name: string }> = [
  { lat: 37.8199, lng: -122.4783, name: "Golden Gate Bridge" },
  { lat: 37.8267, lng: -122.4230, name: "Alcatraz" },
  { lat: 37.8080, lng: -122.4177, name: "Fisherman's Wharf" },
  { lat: 37.7955, lng: -122.3937, name: "Ferry Building" },
  { lat: 37.7983, lng: -122.3778, name: "Bay Bridge" },
  { lat: 37.7792, lng: -122.4191, name: "City Hall" },
  { lat: 37.7786, lng: -122.3893, name: "Oracle Park" },
  { lat: 37.8024, lng: -122.4058, name: "Coit Tower" },
  { lat: 37.7694, lng: -122.4862, name: "Golden Gate Park" },
  { lat: 37.7544, lng: -122.4477, name: "Twin Peaks" },
];

/** SF boundary polygon rings in GeoJSON [lng, lat] format. */
const SF_BOUNDARY_RINGS: number[][][] = [[
  [-122.4785, 37.8105], // Ft Point / GG Bridge south
  [-122.4834, 37.7936], // Baker Beach
  [-122.5070, 37.7960], // Lands End
  [-122.5129, 37.7887], // Cliff House
  [-122.5118, 37.7529], // Ocean Beach mid
  [-122.5063, 37.7068], // Fort Funston SW
  [-122.4560, 37.7084], // south border
  [-122.4100, 37.7084], // south border east
  [-122.3957, 37.7135], // SE corner
  [-122.3893, 37.7786], // Oracle Park waterfront
  [-122.3878, 37.7883], // Bay Bridge south waterfront
  [-122.3937, 37.7955], // Ferry Building
  [-122.4098, 37.8087], // Pier 39 / NE waterfront
  [-122.4228, 37.8073], // Aquatic Park
  [-122.4313, 37.8060], // Fort Mason
  [-122.4620, 37.8055], // Crissy Field
  [-122.4785, 37.8105], // close
]];

/** R9 cells inside the SF boundary — precomputed, used as flat-fill layer. */
const SF_FILL_CELLS: string[] = polygonToCells(SF_BOUNDARY_RINGS, 9, true);

type DeckViewState = MapViewState & {
  transitionDuration?: number;
  transitionInterpolator?: LinearInterpolator;
  transitionEasing?: (t: number) => number;
};

function computeMapCamera(
  vs: ViewState,
  tiles: ReadonlyMap<string, WorldTile>,
  ghosts: ReadonlyMap<string, GhostPosition>,
  situationalH3: string | undefined,
  w: number,
  h: number,
): { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number } {
  const pitch = STOP_PITCH[vs.stop];
  // Exterior stops — Phase 11 will add distinct rendering; for now use coarse zooms.
  if (vs.stop === "global") {
    const v = globalView(tiles);
    return { ...v, pitch, bearing: 0 };
  }
  if (vs.stop === "regional") {
    const v = regionalView(tiles);
    return { ...v, pitch, bearing: 0 };
  }
  // Interior stops
  if (vs.stop === "plan") {
    const m = mapViewFromTileBounds(tiles, w, h);
    if (m) return { ...m, pitch, bearing: 0 };
  }
  if (vs.stop === "room") {
    const focusH3 = vs.focus ?? centerH3(tiles);
    if (focusH3) return { ...areaViewFromFocus(focusH3, w, h), pitch, bearing: 0 };
  }
  if (vs.stop === "situational" && vs.focus) {
    // Ghost h3 → tile h3 (when arriving from room via = key) → undefined
    const h3 = situationalH3 ?? ghosts.get(vs.focus)?.h3Index ?? (isValidCell(vs.focus) ? vs.focus : undefined);
    if (h3) {
      const n = neighborView(h3, w, h);
      return { ...n, pitch, bearing: 0 };
    }
  }
  const m = mapViewFromTileBounds(tiles, w, h) ?? { longitude: 0, latitude: 20, zoom: 2 };
  return { ...m, pitch, bearing: 0 };
}

/**
 * US1+US2: 7-stop spatial scene rendered via deck.gl (geospatial stops only).
 * Personal stop is handled in App.tsx via PersonalScene (ADR-0006).
 * Exterior stop rendering (extruded board) arrives in Phase 11 (T087).
 */
export function SceneView() {
  const { tiles, ghosts, viewState, nav, tileTypeStyles } = useClientState();
  const [hover, setHover] = useState<{
    readonly tile: WorldTile;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [landmarkHover, setLandmarkHover] = useState<{
    readonly name: string;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const isGlobeStop = viewState.stop === "global" || viewState.stop === "regional";
  const lastClick = useRef<{ t: number; id: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  const [debugVisible, setDebugVisible] = useState(false);
  const lockedZoomRef = useRef(12);
  const globeRafRef = useRef<number | null>(null);
  const globeLastTsRef = useRef<number | null>(null);
  // Tracks when a camera transition ends so the rotation RAF doesn't cancel it.
  const cameraTransitionUntilRef = useRef(0);
  // Phase 2 of room↔plan transitions: driven by our own rAF loop (not deck.gl transitions).
  const phase2RafRef = useRef(0);
  // Previous stop for transition duration decisions (plan ↔ room needs longer animation).
  const prevStopRef = useRef(viewState.stop);
  // Ghost positions frozen during camera transitions to reduce per-frame layer work.
  const [displayGhosts, setDisplayGhosts] = useState(ghosts);
  const ghostsRef = useRef(ghosts);
  ghostsRef.current = ghosts;
  const isTransitioningRef = useRef(false);
  // Last valid room-stop focus H3 — captured while in Room so room→plan can keep tiles culled.
  const roomExitFocusRef = useRef<string | null>(null);
  // Non-null during room→plan outbound transition; keeps roomTiles culled until camera settles.
  const [leavingRoomFocusH3, setLeavingRoomFocusH3] = useState<string | null>(null);
  const leavingRoomTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Separate prev-stop ref for the layout effect — must not share with the regular effect's
  // prevStopRef because useLayoutEffect runs before useEffect in the same commit.
  const prevStopForCullRef = useRef(viewState.stop);
  // Stable refs so onInteractionStateChange (a stale closure) can read current values.
  const firstBoardH3Ref = useRef<string | null>(null);
  const drillLevelRef = useRef(0);
  // Regional drill-down animation: R0 → R5 parent hex reveal.
  const firstBoardH3 = useMemo(
    () => tiles.values().next().value?.h3Index ?? null,
    [tiles],
  );
  // Keep ref in sync so onViewStateChange (a stale closure) can read the latest value.
  firstBoardH3Ref.current = firstBoardH3;

  // Mesh cells and SF fill — state only; computed lazily after drill camera settles.
  const [regionalMeshData, setRegionalMeshData] = useState<{ readonly cells: MeshCell[]; readonly maxDist: number }>({ cells: [], maxDist: 0 });
  const [sfFillData, setSfFillData] = useState<MeshCell[]>([]);

  // Reveal radius for the regional wave-sweep animation: -1 = not started.
  const revealRafRef = useRef<number | null>(null);
  const [revealRadius, setRevealRadius] = useState(-1);

  const { drillLevel, drillViewport, parentCells, venueR10, venueR12, drillEasing } = useRegionalDrill(
    firstBoardH3,
    tiles,
    viewState.stop === "regional",
    vp.w,
    vp.h,
  );
  drillLevelRef.current = drillLevel;

  // Drive camera for each drill step (separate from the centerKey effect).
  useEffect(() => {
    if (viewState.stop !== "regional" || !drillViewport) return;
    let { longitude, latitude } = drillViewport;
    // Final drill step: land centered on the venue marker rather than R5 centroid
    if (drillLevel === REGIONAL_DRILL_MAX && firstBoardH3 && isValidCell(firstBoardH3)) {
      const venueR9 = cellToParent(firstBoardH3, 9);
      const [vLat, vLng] = cellToLatLng(venueR9);
      latitude = vLat;
      longitude = vLng;
    }
    setDeckVS((v) => ({
      ...v,
      longitude,
      latitude,
      zoom: drillViewport.zoom,
      pitch: 0,
      bearing: 0,
      transitionDuration: 500,
      transitionInterpolator: TRANSITION_INTERPOLATOR,
      transitionEasing: drillEasing,
    }));
  }, [drillLevel, drillViewport, drillEasing, viewState.stop, firstBoardH3]);

  // ── Wave-sweep reveal: starts after the final drill camera transition settles ──
  useEffect(() => {
    if (viewState.stop !== "regional" || drillLevel < PARENT_DRILL_MAX) {
      setRevealRadius(-1);
      if (revealRafRef.current !== null) {
        cancelAnimationFrame(revealRafRef.current);
        revealRafRef.current = null;
      }
      return;
    }
    // Delay matches the 500ms drill camera transition so the wave only starts
    // once the camera has fully settled at city scale.
    const CAMERA_SETTLE_MS = 520;
    const DURATION = 1400;
    const target = regionalMeshData.maxDist + WAVE_WIDTH;
    let rafId: number | null = null;
    const delayId = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        setRevealRadius((1 - Math.pow(1 - t, 2)) * target); // ease-out
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
          revealRafRef.current = rafId;
        } else {
          revealRafRef.current = null;
        }
      };
      rafId = requestAnimationFrame(tick);
      revealRafRef.current = rafId;
    }, CAMERA_SETTLE_MS);
    return () => {
      clearTimeout(delayId);
      if (revealRafRef.current !== null) {
        cancelAnimationFrame(revealRafRef.current);
        revealRafRef.current = null;
      }
    };
  }, [drillLevel, viewState.stop, regionalMeshData.maxDist]);

  // ── Venue zoom: Regional → Plan transition (levels 6–8) ─────────────────────
  // Venue cells computed directly — drill stops at level 5, hook venueR10/R12 are null there.
  const venueCellR10 = useMemo(
    () => firstBoardH3 && isValidCell(firstBoardH3) ? cellToParent(firstBoardH3, 10) : null,
    [firstBoardH3],
  );
  const venueCellR12 = useMemo(
    () => firstBoardH3 && isValidCell(firstBoardH3) ? cellToParent(firstBoardH3, 12) : null,
    [firstBoardH3],
  );

  // venueZoomActiveRef is set synchronously in the activation effect (defined before
  // the centerKey camera effect) so the centerKey effect can see it in the same render.
  const venueZoomActiveRef = useRef(false);
  const vzPrevStopRef = useRef(viewState.stop);
  const [venueZoomLevel, setVenueZoomLevel] = useState(0);

  // Activation — useLayoutEffect so venueZoomLevel=6 is set before first paint,
  // preventing a one-frame flash of the Normal Plan layers on Regional→Plan.
  // MUST be defined before the centerKey camera effect.
  useLayoutEffect(() => {
    const prev = vzPrevStopRef.current;
    vzPrevStopRef.current = viewState.stop;
    if (prev === "regional" && viewState.stop === "plan") {
      venueZoomActiveRef.current = true; // synchronous — blocks centerKey camera below
      setVenueZoomLevel(6);
    } else if (viewState.stop !== "plan") {
      venueZoomActiveRef.current = false;
      setVenueZoomLevel(0);
    }
  }, [viewState.stop]);

  // Timer — advance 6→7→8 at 500ms each; clear active flag when done.
  useEffect(() => {
    if (venueZoomLevel === 0) return;
    if (venueZoomLevel >= 8) {
      venueZoomActiveRef.current = false;
      return;
    }
    const t = setTimeout(() => setVenueZoomLevel((l) => l + 1), 500);
    return () => clearTimeout(t);
  }, [venueZoomLevel]);

  // ── Plan mesh — 4-ring BFS halo; computed lazily on first plan stop visit ───
  const [planMeshData, setPlanMeshData] = useState<{ readonly cells: MeshCell[]; readonly maxDist: number }>({ cells: [], maxDist: 0 });
  const planMeshDataRef = useRef(planMeshData);
  planMeshDataRef.current = planMeshData;
  const planRevealRafRef = useRef<number | null>(null);
  const [planRevealRadius, setPlanRevealRadius] = useState(-1);

  const PLAN_HALO_RINGS = 4;
  useEffect(() => {
    if (viewState.stop !== "plan" || tiles.size === 0) return;
    setPlanMeshData((prev) => {
      if (prev.cells.length > 0) return prev;
      const tileSet = new Set(tiles.keys());
      const visited = new Set<string>(tileSet);
      const cells: MeshCell[] = [];
      let frontier = Array.from(tileSet);
      for (let dist = 1; dist <= PLAN_HALO_RINGS; dist++) {
        const next: string[] = [];
        for (const h3 of frontier) {
          for (const neighbor of gridDisk(h3, 1)) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              next.push(neighbor);
              cells.push({ h3Index: neighbor, dist });
            }
          }
        }
        frontier = next;
      }
      return { cells, maxDist: cells.length > 0 ? Math.max(...cells.map((c) => c.dist)) : 0 };
    });
  }, [viewState.stop, tiles.size]);

  // Keep defaultFocus in sync so arrow keys work at Room even when entered via cycleIn (focus: null).
  // Also tracks room exit focus so the room→plan outbound transition can keep tiles culled.
  useEffect(() => {
    if (viewState.stop === "room" || viewState.stop === "situational") {
      const h3 = centerH3(tiles) ?? null;
      nav.setDefaultFocus(h3);
      roomExitFocusRef.current = viewState.focus ?? h3;
    } else {
      nav.setDefaultFocus(null);
    }
  }, [viewState.stop, viewState.focus, tiles, nav]);

  // Set leavingRoomFocusH3 synchronously (before browser paint) when leaving Room so the
  // culled tile disk is never dropped for even one rendered frame.
  // useLayoutEffect runs after commit but before paint — the subsequent re-render caused by
  // setLeavingRoomFocusH3 is batched into the same paint cycle.
  useLayoutEffect(() => {
    const prev = prevStopForCullRef.current;
    prevStopForCullRef.current = viewState.stop;
    if (prev === "room" && viewState.stop === "plan") {
      setLeavingRoomFocusH3(roomExitFocusRef.current);
    } else if (viewState.stop === "room") {
      // Re-entering room: cancel any lingering outbound culling guard.
      clearTimeout(leavingRoomTimerRef.current);
      setLeavingRoomFocusH3(null);
    }
  }, [viewState.stop]);

  // ── Plan reveal sweep — starts 520ms after step-8 camera fires ──────────────
  useEffect(() => {
    if (viewState.stop !== "plan" || venueZoomLevel < 8 || planMeshData.maxDist === 0) {
      if (viewState.stop !== "plan" || venueZoomLevel < 8) {
        setPlanRevealRadius(-1);
        if (planRevealRafRef.current !== null) {
          cancelAnimationFrame(planRevealRafRef.current);
          planRevealRafRef.current = null;
        }
      }
      return;
    }
    const CAMERA_SETTLE_MS = 520;
    const DURATION = 900;
    const target = planMeshData.maxDist + WAVE_WIDTH;
    let rafId: number | null = null;
    const delayId = setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        setPlanRevealRadius((1 - Math.pow(1 - t, 2)) * target);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
          planRevealRafRef.current = rafId;
        } else {
          planRevealRafRef.current = null;
        }
      };
      rafId = requestAnimationFrame(tick);
      planRevealRafRef.current = rafId;
    }, CAMERA_SETTLE_MS);
    return () => {
      clearTimeout(delayId);
      if (planRevealRafRef.current !== null) {
        cancelAnimationFrame(planRevealRafRef.current);
        planRevealRafRef.current = null;
      }
    };
  }, [venueZoomLevel, viewState.stop, planMeshData.maxDist]);

  // Camera per level — strictly one motion per step.
  useEffect(() => {
    if (venueZoomLevel === 0 || viewState.stop !== "plan") return;
    if (!firstBoardH3 || !isValidCell(firstBoardH3)) return;

    // Step 6: PAN ONLY — move center to R10, keep the R5-fit zoom unchanged.
    if (venueZoomLevel === 6 && venueCellR10) {
      const r5Cell = cellToParent(firstBoardH3, 5);
      const r5Zoom = cellFitViewport(r5Cell, vp.w, vp.h, 24).zoom;
      const [r10Lat, r10Lng] = cellToLatLng(venueCellR10);
      setDeckVS((v) => ({
        ...v,
        longitude: r10Lng,
        latitude: r10Lat,
        zoom: r5Zoom,            // zoom unchanged — pan only
        pitch: 0,
        bearing: 0,
        transitionDuration: 500,
        transitionInterpolator: TRANSITION_INTERPOLATOR,
        transitionEasing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
      }));
      return;
    }

    // Step 7: ZOOM to R10 fit — layers unchanged (still regional-end layers).
    if (venueZoomLevel === 7 && venueCellR10) {
      const vport = cellFitViewport(venueCellR10, vp.w, vp.h, 24);
      setDeckVS((v) => ({
        ...v,
        longitude: vport.longitude,
        latitude: vport.latitude,
        zoom: vport.zoom,
        pitch: 0,
        bearing: 0,
        transitionDuration: 500,
        transitionInterpolator: TRANSITION_INTERPOLATOR,
        transitionEasing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
      }));
      return;
    }

    // Step 8: ZOOM to board bounds — centers actual tile footprint, not R12 centroid.
    if (venueZoomLevel >= 8) {
      const vport = mapViewFromTileBounds(tiles, vp.w, vp.h) ??
        (venueCellR12 ? cellFitViewport(venueCellR12, vp.w, vp.h, 24) : null);
      if (vport) {
        setDeckVS((v) => ({
          ...v,
          longitude: vport.longitude,
          latitude: vport.latitude,
          zoom: vport.zoom,
          pitch: 0,
          bearing: 0,
          transitionDuration: 500,
          transitionInterpolator: TRANSITION_INTERPOLATOR,
          transitionEasing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
        }));
      }
      return;
    }
  }, [venueZoomLevel, viewState.stop, firstBoardH3, venueCellR10, venueCellR12, vp.w, vp.h]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setVp({ w: Math.max(32, width), h: Math.max(32, height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `d` key toggles the debug overlay.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "d" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setDebugVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const situationalGhostH3 =
    viewState.stop === "situational" && viewState.focus
      ? ghosts.get(viewState.focus)?.h3Index
      : undefined;

  const centerKey = useMemo(
    () =>
      `${viewState.stop}:${viewState.focus ?? ""}:${viewState.stop === "situational" ? (situationalGhostH3 ?? "") : ""}:${vp.w}x${vp.h}`,
    [viewState, situationalGhostH3, vp.w, vp.h],
  );

  const target = useMemo(
    () => computeMapCamera(viewState, tiles, ghosts, situationalGhostH3, vp.w, vp.h),
    [viewState.stop, viewState.focus, tiles, ghosts, situationalGhostH3, vp.w, vp.h],
  );
  // Always-current ref so the centerKey effect reads the latest target without
  // needing it as a dep (which would re-fire on every ghost position update).
  const targetRef = useRef(target);
  targetRef.current = target;

  // LOD: Regional drill level 8 shows board tiles (flat interior mode).
  // All other exterior stops and early Regional levels show extruded geometry.
  const lodExtruded = !(viewState.stop === "plan" || viewState.stop === "room" || viewState.stop === "situational" ||
    (viewState.stop === "regional" && drillLevel >= REGIONAL_DRILL_MAX));

  const [deckVS, setDeckVS] = useState<DeckViewState>({
    longitude: target.longitude,
    latitude: target.latitude,
    zoom: target.zoom,
    pitch: target.pitch,
    bearing: 0,
  });
  // Always-current snapshot of deckVS — read by Phase 2 rAF to capture the start position
  // after Phase 1 completes (echo-backs keep this in sync with the animated camera).
  const deckVSRef = useRef(deckVS);
  deckVSRef.current = deckVS;

  // Slow globe rotation — active only at Global stop (0.5 °/s westward drift).
  useEffect(() => {
    const DEGREES_PER_MS = 2 / 1000;
    if (viewState.stop !== "global") {
      if (globeRafRef.current !== null) cancelAnimationFrame(globeRafRef.current);
      globeRafRef.current = null;
      globeLastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (ts < cameraTransitionUntilRef.current) {
        // A camera transition (e.g. regional → global zoom-out) is in flight;
        // pause rotation and reset delta so there's no jump when it resumes.
        globeLastTsRef.current = null;
        globeRafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (globeLastTsRef.current !== null) {
        const delta = ts - globeLastTsRef.current;
        setDeckVS((v) => ({
          ...v,
          longitude: v.longitude + delta * DEGREES_PER_MS,
          transitionDuration: 0,
          transitionInterpolator: undefined,
          transitionEasing: undefined,
        }));
      }
      globeLastTsRef.current = ts;
      globeRafRef.current = requestAnimationFrame(tick);
    };
    globeRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (globeRafRef.current !== null) cancelAnimationFrame(globeRafRef.current);
      globeRafRef.current = null;
      globeLastTsRef.current = null;
    };
  }, [viewState.stop]);

  // Pass ghost updates through only when the camera isn't mid-transition.
  useEffect(() => {
    if (!isTransitioningRef.current) {
      setDisplayGhosts(ghosts);
    }
  }, [ghosts]);

  useEffect(() => {
    if (venueZoomActiveRef.current) return; // venue zoom controls camera during transition
    const prev = prevStopRef.current;
    prevStopRef.current = viewState.stop;
    const interiorStops = new Set(["plan", "room", "situational"]);
    const crossesDepth =
      interiorStops.has(prev) && interiorStops.has(viewState.stop) && prev !== viewState.stop;
    const t = targetRef.current;
    lockedZoomRef.current = t.zoom;

    let phaseTimer: ReturnType<typeof setTimeout> | undefined;

    // Mark transitioning immediately so ghost updates are suppressed during the pan.
    // onInteractionStateChange fires async and can miss the transition start window.
    isTransitioningRef.current = true;

    if (crossesDepth) {
      // Phased transition — direction determines phase order:
      //   Plan→Room: tilt first (pitch), then zoom in  (tiles culled immediately at stop change)
      //   Room→Plan: tilt to 0° first,  then zoom out  (tiles stay culled, full set sweeps in after)
      // Phase 1 uses deck.gl's transition system (PITCH_INTERPOLATOR); it works because echo-back
      // stays in sync with the animated pitch each frame.
      // Phase 2 uses our own requestAnimationFrame loop with transitionDuration:0 to avoid the
      // echo-back race — onViewStateChange can clobber a freshly-set deck.gl transition config
      // in the same JS task, causing Phase 2 to snap instantly rather than animate.
      if (prev === "room" && viewState.stop === "plan") {
        cameraTransitionUntilRef.current = performance.now() + DEPTH_PITCH_DURATION + DEPTH_ZOOM_DURATION + 50;
        // ── Outbound: Room → Plan ─────────────────────────────────────────
        // leavingRoomFocusH3 was already set synchronously by the useLayoutEffect above.
        // Phase 1: tilt to 0° via deck.gl transition (while still at room zoom, tiles culled)
        setDeckVS((v) => ({
          ...v,
          pitch: t.pitch,
          transitionDuration: DEPTH_PITCH_DURATION,
          transitionInterpolator: PITCH_INTERPOLATOR,
          transitionEasing: easeOutCubic,
        }));
        // Phase 2: manual rAF loop — zoom out + pan to plan center.
        // deckVSRef reflects Phase 1's final echo-back position when this fires.
        phaseTimer = setTimeout(() => {
          const t2 = targetRef.current;
          const sv = deckVSRef.current;
          const startLon = sv.longitude;
          const startLat = sv.latitude;
          const startZoom = sv.zoom;
          const phase2Start = performance.now();
          const runPhase2 = () => {
            const rawT = Math.min(1, (performance.now() - phase2Start) / DEPTH_ZOOM_DURATION);
            const e = easeOutCubic(rawT);
            setDeckVS((v2) => ({
              ...v2,
              longitude: startLon + (t2.longitude - startLon) * e,
              latitude: startLat + (t2.latitude - startLat) * e,
              zoom: startZoom + (t2.zoom - startZoom) * e,
              bearing: 0,
              transitionDuration: 0,
              transitionInterpolator: undefined,
              transitionEasing: undefined,
            }));
            if (rawT < 1) {
              phase2RafRef.current = requestAnimationFrame(runPhase2);
            } else {
              // Phase 2 complete — reveal plan layers with a wave sweep.
              // setPlanRevealRadius(0) arms the sweep flag; the layers useMemo renders
              // board + mesh at opacity 0 on this frame, then the rAF loop below
              // animates radius to target (~600 ms, easeOutQuad).
              setLeavingRoomFocusH3(null);
              setPlanRevealRadius(0);
              const SWEEP_DURATION = 600;
              const sweepStart = performance.now();
              const sweepTarget = planMeshDataRef.current.maxDist + WAVE_WIDTH;
              const sweepTick = (now: number) => {
                const st = Math.min(1, (now - sweepStart) / SWEEP_DURATION);
                const eased = 1 - Math.pow(1 - st, 2); // easeOutQuad
                setPlanRevealRadius(eased * sweepTarget);
                if (st < 1) {
                  planRevealRafRef.current = requestAnimationFrame(sweepTick);
                } else {
                  planRevealRafRef.current = null;
                }
              };
              if (planRevealRafRef.current !== null) cancelAnimationFrame(planRevealRafRef.current);
              planRevealRafRef.current = requestAnimationFrame(sweepTick);
            }
          };
          phase2RafRef.current = requestAnimationFrame(runPhase2);
        }, DEPTH_PITCH_DURATION);
      } else {
        cameraTransitionUntilRef.current = performance.now() + DEPTH_PITCH_DURATION + DEPTH_ZOOM_DURATION + 50;
        // ── Inbound: Plan → Room (or other depth-crossing) ───────────────
        // Tiles are culled immediately when stop becomes "room".
        // Phase 1: tilt via deck.gl transition
        setDeckVS((v) => ({
          ...v,
          pitch: t.pitch,
          transitionDuration: DEPTH_PITCH_DURATION,
          transitionInterpolator: PITCH_INTERPOLATOR,
          transitionEasing: easeOutCubic,
        }));
        // Phase 2: manual rAF loop — zoom in + pan to room center.
        phaseTimer = setTimeout(() => {
          const t2 = targetRef.current;
          const sv = deckVSRef.current;
          const startLon = sv.longitude;
          const startLat = sv.latitude;
          const startZoom = sv.zoom;
          const phase2Start = performance.now();
          const runPhase2 = () => {
            const rawT = Math.min(1, (performance.now() - phase2Start) / DEPTH_ZOOM_DURATION);
            const e = easeOutCubic(rawT);
            setDeckVS((v2) => ({
              ...v2,
              longitude: startLon + (t2.longitude - startLon) * e,
              latitude: startLat + (t2.latitude - startLat) * e,
              zoom: startZoom + (t2.zoom - startZoom) * e,
              bearing: 0,
              transitionDuration: 0,
              transitionInterpolator: undefined,
              transitionEasing: undefined,
            }));
            if (rawT < 1) phase2RafRef.current = requestAnimationFrame(runPhase2);
          };
          phase2RafRef.current = requestAnimationFrame(runPhase2);
        }, DEPTH_PITCH_DURATION);
      }
    } else {
      const roomFocusPan = prev === "room" && viewState.stop === "room";
      const duration = roomFocusPan ? ROOM_FOCUS_PAN_DURATION : TRANSITION_DURATION;
      cameraTransitionUntilRef.current = performance.now() + duration + 50;
      setDeckVS((v) => ({
        ...v,
        longitude: t.longitude,
        latitude: t.latitude,
        zoom: t.zoom,
        pitch: t.pitch,
        bearing: 0,
        transitionDuration: duration,
        transitionInterpolator: TRANSITION_INTERPOLATOR,
        transitionEasing: easeOutCubic,
      }));
    }

    return () => {
      clearTimeout(phaseTimer);
      cancelAnimationFrame(phase2RafRef.current);
      clearTimeout(leavingRoomTimerRef.current);
    };
  }, [centerKey, tiles.size, viewState.stop]);

  const voidH3 = useMemo(() => voidNeighborH3s(tiles), [tiles]);

  // At Room stop, cull tiles to a viewport-sized disk so the hex grid layer only
  // processes cells that can actually be visible. Outside Room the full tile set is fine.
  // leavingRoomFocusH3 stays non-null during the room→plan outbound transition so the
  // culled tile set is kept until the camera finishes zooming out and levelling.
  const roomFocusH3 = viewState.stop === "room"
    ? (viewState.focus ?? centerH3(tiles) ?? null)
    : leavingRoomFocusH3;
  const roomTiles = useMemo(
    () => (roomFocusH3 ? tilesInDisk(tiles, roomFocusH3, ROOM_RENDER_RADIUS) : tiles),
    [tiles, roomFocusH3],
  );

  // _GlobeView for globe-scale stops; MapView for interior stops.
  // _GlobeView silently clamps zoom below its max (~20), so Room/Plan/Situational
  // must use MapView to reach the zoom levels (18–26) needed for street-scale.
  const activeView = useMemo(
    () => isGlobeStop
      ? new _GlobeView({ id: "globe" })
      : new MapView({ id: "map" }),
    [isGlobeStop],
  );

  const iconFilter = useCallback(
    (t: WorldTile) =>
      t.items.length > 0 ||
      /vendor|session|lounge|booth|room|corridor/i.test(t.tileType),
    [],
  );

  const layers = useMemo(() => {
    if (tiles.size === 0) return [];
    const s: CameraStop = (viewState.stop === "plan" && leavingRoomFocusH3 !== null)
      ? "room"
      : viewState.stop;

    // ── Shared helper: Regional-end layers (drillLevel=5 content, stable IDs) ──
    // Hoisted before the global branch so global reuses the same layer IDs,
    // giving deck.gl continuity through the stop change (no layer pop on pan-in).
    const buildRegionalEndLayers = (): Layer[] => {
      if (!firstBoardH3 || !isValidCell(firstBoardH3)) return [];
      const globe = createH3WireframeLayer(getRes0Cells(), "regional-globe", false, 0.18);
      const rings = Array.from({ length: PARENT_DRILL_MAX + 1 }, (_, r) => {
        const cell = cellToParent(firstBoardH3, r);
        const opacity = 0.3 + (r / Math.max(PARENT_DRILL_MAX, 1)) * 0.6;
        return createH3WireframeLayer([cell], `regional-drill-r${r}`, false, opacity);
      });
      // Venue + landmark markers with names for hover tooltip
      const venueR9 = cellToParent(firstBoardH3, 9);
      const seenR9 = new Set([venueR9]);
      const landmarkEntries = SF_LANDMARKS
        .map(({ lat, lng, name }) => ({ h3Index: latLngToCell(lat, lng, 9), name }))
        .filter(({ h3Index }) => {
          if (seenR9.has(h3Index)) return false;
          seenR9.add(h3Index);
          return true;
        });
      const markerData: LandmarkMarker[] = [
        { h3Index: venueR9, isVenue: true, name: "Moscone Center" },
        ...landmarkEntries.map(({ h3Index, name }) => ({ h3Index, isVenue: false, name })),
      ];
      const markers = new H3HexagonLayer<LandmarkMarker>({
        id: "regional-landmarks",
        data: markerData,
        pickable: true,
        extruded: true,
        elevationScale: 1,
        getElevation: () => 800,
        getHexagon: (d) => d.h3Index,
        filled: true,
        getFillColor: (d) => d.isVenue ? [0, 210, 220, 240] : [255, 160, 50, 210],
        stroked: false,
      });
      // Heavy layers only once the drill has reached city scale.
      if (drillLevel < PARENT_DRILL_MAX) {
        return [globe, ...rings, markers];
      }
      const expandedMesh = new H3HexagonLayer<MeshCell>({
        id: "regional-r9-grid",
        data: regionalMeshData.cells,
        getHexagon: (d) => d.h3Index,
        filled: true,
        getFillColor: (d) => [20, 25, 35, Math.floor(255 * 0.6 * waveOpacity(d.dist, revealRadius))],
        stroked: true,
        getLineColor: (d) => [100, 140, 195, Math.floor(255 * 0.35 * waveOpacity(d.dist, revealRadius))],
        lineWidthUnits: "pixels",
        getLineWidth: 1.2,
        lineWidthMinPixels: 1,
        extruded: false,
        highPrecision: true,
        coverage: 1,
        pickable: false,
        updateTriggers: {
          getFillColor: revealRadius,
          getLineColor: revealRadius,
        },
      });
      const sfFill = new H3HexagonLayer<MeshCell>({
        id: "sf-fill",
        data: sfFillData,
        getHexagon: (d) => d.h3Index,
        filled: true,
        getFillColor: (d) => [0, 180, 210, Math.floor(30 * waveOpacity(d.dist, revealRadius))],
        extruded: false,
        stroked: false,
        pickable: false,
        updateTriggers: { getFillColor: revealRadius },
      });
      return [globe, ...rings, expandedMesh, sfFill, markers];
    };

    // ── Global: pre-render lightweight regional layers ───────────────────────
    // Shared IDs keep layer instances alive through the stop change so the
    // drill-in starts with markers already on screen. Heavy layers (mesh + SF fill)
    // are gated on drillLevel inside buildRegionalEndLayers, so they are never
    // built here (drillLevel resets to 0 when regional stop is inactive).
    if (s === "global") {
      const regionalLayers = buildRegionalEndLayers();
      if (regionalLayers.length === 0) {
        return [createH3WireframeLayer(getRes0Cells(), "regional-globe", false, 0.35)];
      }
      return regionalLayers;
    }

    // ── Regional: drill + venue zoom, rings/grid persist as base throughout ────
    if (s === "regional") {
      const base = buildRegionalEndLayers();

      // Levels 0–PARENT_DRILL_MAX: base layers are already fully visible;
      // camera animates inward while the rings provide continuous context.
      if (drillLevel <= PARENT_DRILL_MAX) {
        return base;
      }

      // Levels 6–8: venue zoom — add detail layers on top of base.
      if (drillLevel === 6 && venueR10) {
        const r10Outline = createH3WireframeLayer([venueR10], "r10-focus", false, 0.9);
        return [...base, r10Outline];
      }

      if (drillLevel === 7 && venueR10 && venueR12) {
        const r12Cells = cellToChildren(venueR10, 12);
        const r10Faint = createH3WireframeLayer([venueR10], "r10-faint", false, 0.25);
        const r12Grid = createH3WireframeLayer(r12Cells, "r12-grid", false, 0.5);
        return [...base, r10Faint, r12Grid];
      }

      if (drillLevel >= 8 && venueR10) {
        const r12Cells = cellToChildren(venueR10, 12);
        const r12Bg = createH3WireframeLayer(r12Cells, "r12-bg", false, 0.18);
        const boardLayer = createHexGridLayer(tiles, {
          pickable: false,
          id: "regional-board",
          tileStyles: tileTypeStyles,
          extruded: true,
          elevation: 3,
          opacity: 0.95,
        });
        return [...base, r12Bg, boardLayer];
      }

      return base;
    }

    if (s === "plan") {
      const boardLayer = createHexGridLayer(tiles, { pickable: true, id: "plan-hex", extruded: lodExtruded, tileStyles: tileTypeStyles });

      // Shared animated plan mesh layer — used both during step-8 sweep and Normal Plan.
      const planMeshLayer = planMeshData.cells.length > 0
        ? new H3HexagonLayer<MeshCell>({
            id: "plan-mesh",
            data: planMeshData.cells,
            getHexagon: (d) => d.h3Index,
            filled: true,
            getFillColor: (d) => [20, 25, 35, Math.floor(255 * 0.6 * waveOpacity(d.dist, planRevealRadius))],
            stroked: true,
            getLineColor: (d) => [100, 140, 195, Math.floor(255 * 0.4 * waveOpacity(d.dist, planRevealRadius))],
            lineWidthUnits: "pixels",
            getLineWidth: 1.2,
            extruded: false,
            pickable: false,
            updateTriggers: { getFillColor: planRevealRadius, getLineColor: planRevealRadius },
          })
        : null;

      // Steps 6 & 7: regional context layers persist — only camera moves.
      if (venueZoomLevel === 6 || venueZoomLevel === 7) {
        return buildRegionalEndLayers();
      }

      // Step 8: regional layers until sweep starts, then board + animated plan mesh.
      if (venueZoomLevel >= 8) {
        if (planRevealRadius < 0) {
          // Camera still settling — keep regional context visible.
          return buildRegionalEndLayers();
        }
        const layers: Layer[] = [boardLayer, createGhostPointCloudLayer(displayGhosts)];
        if (planMeshLayer) layers.unshift(planMeshLayer);
        return layers;
      }

      // Normal Plan — arrived from a non-Regional stop (e.g. from Room).
      // When planRevealRadius ≥ 0 a sweep is active (triggered by Phase 2 rAF completion):
      //   • board tiles fade in (easeOutCubic ramp from 0→1 as radius grows)
      //   • hex mesh border sweeps outward via planMeshLayer (same waveOpacity as step-8)
      // When planRevealRadius < 0 (e.g. page load, direct navigation) show statically.
      const sweepTarget = Math.max(1, planMeshData.maxDist + WAVE_WIDTH);
      const sweeping = planRevealRadius >= 0;
      const normalBoard = sweeping
        ? createHexGridLayer(tiles, {
            pickable: true,
            id: "plan-hex",
            extruded: lodExtruded,
            tileStyles: tileTypeStyles,
            opacity: easeOutCubic(Math.min(1, planRevealRadius / sweepTarget)),
          })
        : boardLayer;
      const normalMesh = sweeping
        ? planMeshLayer  // already animated via waveOpacity(d.dist, planRevealRadius)
        : planMeshData.cells.length > 0
          ? new H3HexagonLayer<MeshCell>({
              id: "plan-mesh",
              data: planMeshData.cells,
              getHexagon: (d) => d.h3Index,
              filled: true,
              getFillColor: () => [20, 25, 35, Math.floor(255 * 0.6)],
              stroked: true,
              getLineColor: () => [100, 140, 195, Math.floor(255 * 0.4)],
              lineWidthUnits: "pixels",
              getLineWidth: 1.2,
              extruded: false,
              pickable: false,
            })
          : (voidH3.length > 0 ? createH3WireframeLayer(voidH3, "plan-mesh", false, 0.45) : null);
      return [
        ...(normalMesh ? [normalMesh] : []),
        normalBoard,
        createGhostPointCloudLayer(displayGhosts),
      ];
    }

    if (s === "room") {
      // During room→plan outbound transition, roomFocusH3 falls back to leavingRoomFocusH3
      // so the culled Room tile set stays locked until the transition completes.
      const focusH3 = roomFocusH3;
      const disk = focusH3 ? cellDisk(focusH3, AREA_DISK_K) : new Set<string>();
      const diskH3s = [...disk];
      const gpick = ghostPickInDisk(ghosts, disk);
      const iconData = buildIconTileData(roomTiles, iconFilter);
      return [
        createHexGridLayer(roomTiles, {
          pickable: true,
          id: "room-board",
          extruded: false,
          tileStyles: tileTypeStyles,
          distanceFade: focusH3
            ? { focusH3, innerK: AREA_DISK_K, outerK: ROOM_RENDER_RADIUS }
            : undefined,
        }),
        createSelectionH3Layer(diskH3s, roomTiles, { id: "room-spotlight" }),
        createTileIconLayer(iconData, "room-icons"),
        createGhostPointCloudLayer(displayGhosts),
        createGhostPickLayer(gpick, "room-ghost-pick", true),
      ];
    }

    if (s === "situational" && viewState.focus) {
      const g0 = ghosts.get(viewState.focus);
      if (!g0) {
        return [
          createHexGridLayer(tiles, { pickable: true, id: "plan-hex", tileStyles: tileTypeStyles }),
          createGhostPointCloudLayer(displayGhosts),
        ];
      }
      const disk = cellDisk(g0.h3Index, NEIGHBOR_DISK_K);
      const diskTiles = Array.from(tiles.values()).filter((t) => disk.has(t.h3Index));
      const diskMap: Map<string, WorldTile> = new Map(
        diskTiles.map((t) => [t.h3Index, t] as const),
      );
      const iconData = buildIconTileData(
        diskMap,
        (t) => iconFilter(t) && disk.has(t.h3Index),
      );
      const gpick = ghostPickInDisk(ghosts, disk);
      return [
        createHexGridLayer(tiles, {
          pickable: false,
          id: "situational-world",
          extruded: false,
          opacity: 0.3,
          uniformBackdrop: { r: 25, g: 38, b: 55, a: 0.45 },
        }),
        createHexGridLayer(diskTiles, {
          pickable: true,
          id: "situational-local",
          extruded: false,
          opacity: 1,
          areaFocusH3: g0.h3Index,
          tileStyles: tileTypeStyles,
        }),
        createSelectionH3Layer([...disk], tiles, { id: "situational-ring" }),
        createTileIconLayer(iconData, "situational-icons"),
        createGhostPointCloudLayer(displayGhosts),
        createGhostPickLayer(gpick, "situational-ghost-pick", true),
      ];
    }

    return [
      createHexGridLayer(tiles, { pickable: true, id: "plan-hex", extruded: false, tileStyles: tileTypeStyles }),
      createGhostPointCloudLayer(displayGhosts),
    ];
  }, [tiles, ghosts, viewState, leavingRoomFocusH3, roomTiles, roomFocusH3, voidH3, iconFilter, lodExtruded, parentCells, venueCellR10, venueCellR12, drillLevel, venueZoomLevel, firstBoardH3, revealRadius, regionalMeshData, sfFillData, planMeshData, planRevealRadius, tileTypeStyles]);

  const onHover = useCallback(
    (info: { object?: unknown; x: number; y: number }) => {
      const o = info.object;
      if (!o) {
        nav.setPickTarget(null);
        setHover(null);
        setLandmarkHover(null);
        return;
      }
      if (isLandmarkMarker(o)) {
        setLandmarkHover({ name: o.name, x: info.x, y: info.y });
        setHover(null);
        return;
      }
      setLandmarkHover(null);
      if (isWorldTile(o) && o.tileType !== "void") {
        if (
          viewState.stop === "plan" ||
          viewState.stop === "room" ||
          viewState.stop === "situational"
        ) {
          nav.setPickTarget({ type: "tile", h3: o.h3Index });
        }
        setHover({ tile: o, x: info.x, y: info.y });
        return;
      }
      if (isGhostPickPoint(o)) {
        if (viewState.stop === "room" || viewState.stop === "situational") {
          nav.setPickTarget({ type: "ghost", ghostId: o.ghostId });
        }
        setHover(null);
        return;
      }
      setHover(null);
    },
    [nav, viewState.stop],
  );

  const onClick = useCallback(
    (info: { object?: unknown }) => {
      const o = info.object;
      if (!o) return;
      if (isWorldTile(o) && o.tileType === "void") return;
      const id = pickId(o);
      const now = Date.now();
      if (lastClick.current && lastClick.current.id === id && now - lastClick.current.t < 600) {
        if (viewState.stop === "plan" && isWorldTile(o)) {
          nav.zoomInFromTile(o.h3Index);
        } else if (viewState.stop === "room" && isWorldTile(o)) {
          nav.relocateFocus(o.h3Index);
        } else if (viewState.stop === "situational" && isGhostPickPoint(o)) {
          nav.zoomInFromGhost(o.ghostId);
        }
        lastClick.current = null;
      } else {
        lastClick.current = { t: now, id };
      }
    },
    [viewState.stop, nav],
  );

  if (tiles.size === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", top: "0", left: "0", right: "0", bottom: "0", minHeight: 0 }}
    >
      <DeckGL
        views={activeView}
        viewState={deckVS}
        onViewStateChange={({ viewState: vsIn }) => {
          // All user interactions are disabled; this fires only during deck.gl transitions.
          // Echo intermediate values back so the animation plays smoothly and deckVSRef
          // stays current (Phase 2 reads it as the start position for its rAF loop).
          setDeckVS(vsIn as DeckViewState);
        }}
        onInteractionStateChange={({ inTransition }) => {
          // Fires when inTransition flips — including false when a transition ends.
          isTransitioningRef.current = inTransition ?? false;
          if (!inTransition) {
            // Flush latest ghost positions now that the camera has settled.
            setDisplayGhosts(ghostsRef.current);
          }
          // This is the true camera-settled event; compute mesh data only after the
          // final drill step's transition completes.
          if (!inTransition && drillLevelRef.current >= PARENT_DRILL_MAX) {
            const h3 = firstBoardH3Ref.current;
            if (h3 && isValidCell(h3)) {
              setRegionalMeshData((prev) => {
                if (prev.cells.length > 0) return prev;
                const r5Cell = cellToParent(h3, 5);
                const venueR9 = cellToParent(h3, 9);
                const cells = gridDisk(r5Cell, 1).flatMap((c) => cellToChildren(c, 9)).map((h3Index) => {
                  let dist = 0;
                  try { dist = gridDistance(h3Index, venueR9); } catch { /* pentagon edge case */ }
                  return { h3Index, dist };
                });
                return { cells, maxDist: cells.reduce((m, c) => Math.max(m, c.dist), 0) };
              });
              setSfFillData((prev) => {
                if (prev.length > 0) return prev;
                const venueR9 = cellToParent(h3, 9);
                return SF_FILL_CELLS.map((h3Index) => {
                  let dist = 0;
                  try { dist = gridDistance(h3Index, venueR9); } catch { /* pentagon edge case */ }
                  return { h3Index, dist };
                });
              });
            }
          }
        }}
        controller={isGlobeStop ? GLOBE_CONTROLLER_OPTIONS : MAP_CONTROLLER_OPTIONS}
        layers={layers}
        onHover={onHover}
        onClick={onClick}
        style={{ position: "absolute", top: "0", left: "0", right: "0", bottom: "0" }}
      />
      {hover ? <TileTooltip tile={hover.tile} x={hover.x} y={hover.y} /> : null}
      {landmarkHover ? <LandmarkTooltip name={landmarkHover.name} x={landmarkHover.x} y={landmarkHover.y} /> : null}
      {debugVisible && (
        <div style={{ position: "absolute", bottom: 40, left: 8, background: "rgba(0,0,0,0.75)", color: "#0ff", fontFamily: "monospace", fontSize: 11, padding: "4px 8px", zIndex: 99, pointerEvents: "none", borderRadius: 3 }}>
          {viewState.stop} z={deckVS.zoom.toFixed(2)} p={(deckVS.pitch ?? 0).toFixed(1)}° {isGlobeStop ? "globe" : "map"}
        </div>
      )}
    </div>
  );
}
