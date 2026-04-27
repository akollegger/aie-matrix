import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DeckGL from "@deck.gl/react";
import { type MapViewState, MapController, LinearInterpolator, _GlobeView } from "deck.gl";
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
  cellDisk,
} from "../../utils/h3region.js";
import {
  mapViewFromTileBounds,
  areaViewFromFocus,
  neighborView,
  globalView,
  regionalView,
  cellFitViewport,
  voidNeighborH3s,
  STOP_PITCH,
} from "../../utils/hexViewport.js";
import { getRes0Cells, cellToChildren, cellToParent, cellToLatLng, latLngToCell, isValidCell } from "h3-js";
import { PARENT_DRILL_MAX } from "../../hooks/useRegionalDrill.js";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { useRegionalDrill, REGIONAL_DRILL_MAX } from "../../hooks/useRegionalDrill.js";
import type { GhostPosition } from "../../types/ghostPosition.js";
import type { WorldTile } from "../../types/worldTile.js";
import type { ViewState } from "../../types/viewState.js";
import { TileTooltip } from "./TileTooltip.js";

const MAP_CONTROLLER: {
  type: typeof MapController;
  scrollZoom: false;
  doubleClickZoom: false;
  dragRotate: false;
  touchZoom: false;
  touchRotate: false;
  keyboard: false;
} = {
  type: MapController,
  scrollZoom: false,
  doubleClickZoom: false,
  dragRotate: false,
  touchZoom: false,
  touchRotate: false,
  keyboard: false,
};

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
const TRANSITION_DURATION = 400;

/** Cubic-in-out easing for smooth stop transitions (FR-028). */
function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const TRANSITION_INTERPOLATOR = new LinearInterpolator(["longitude", "latitude", "zoom", "pitch", "bearing"]);

/**
 * Placeholder SF landmarks for Regional stop orientation layer.
 * Replace with real venue data before launch.
 */
const PLACEHOLDER_LANDMARKS: ReadonlyArray<{ readonly lat: number; readonly lng: number }> = [
  { lat: 37.7955, lng: -122.3937 }, // Ferry Building
  { lat: 37.7879, lng: -122.4074 }, // Union Square
  { lat: 37.7763, lng: -122.3942 }, // Caltrain Station
  { lat: 37.7792, lng: -122.4191 }, // City Hall
  { lat: 37.8080, lng: -122.4177 }, // Fisherman's Wharf
  { lat: 37.7694, lng: -122.4534 }, // Golden Gate Park (east)
  { lat: 37.7786, lng: -122.3893 }, // Oracle Park
];

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
  if (vs.stop === "room" && vs.focus) {
    const a = areaViewFromFocus(vs.focus, w, h);
    return { ...a, pitch, bearing: 0 };
  }
  if (vs.stop === "situational" && vs.focus) {
    const h3 = situationalH3 ?? ghosts.get(vs.focus)?.h3Index;
    if (h3) {
      const n = neighborView(h3, w, h);
      return { ...n, pitch, bearing: 0 };
    }
  }
  const m = mapViewFromTileBounds(tiles, w, h) ?? { longitude: 0, latitude: 20, zoom: 2 };
  return { ...m, pitch: 0, bearing: 0 };
}

/**
 * US1+US2: 7-stop spatial scene rendered via deck.gl (geospatial stops only).
 * Personal stop is handled in App.tsx via PersonalScene (ADR-0006).
 * Exterior stop rendering (extruded board) arrives in Phase 11 (T087).
 */
export function SceneView() {
  const { tiles, ghosts, viewState, nav } = useClientState();
  const [hover, setHover] = useState<{
    readonly tile: WorldTile;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const lastClick = useRef<{ t: number; id: string } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  const lockedZoomRef = useRef(12);
  // Regional drill-down animation: R0 → R5 parent hex reveal.
  const firstBoardH3 = useMemo(
    () => tiles.values().next().value?.h3Index ?? null,
    [tiles],
  );
  const { drillLevel, drillViewport, parentCells, venueR10, venueR12, drillEasing } = useRegionalDrill(
    firstBoardH3,
    tiles,
    viewState.stop === "regional",
    vp.w,
    vp.h,
  );

  // Drive camera for each drill step (separate from the centerKey effect).
  useEffect(() => {
    if (viewState.stop !== "regional" || !drillViewport) return;
    setDeckVS((v) => ({
      ...v,
      longitude: drillViewport.longitude,
      latitude: drillViewport.latitude,
      zoom: drillViewport.zoom,
      pitch: 0,
      bearing: 0,
      transitionDuration: 500,
      transitionInterpolator: TRANSITION_INTERPOLATOR,
      transitionEasing: drillEasing,
    }));
  }, [drillLevel, drillViewport, drillEasing, viewState.stop]);

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

  // Activation — MUST be defined before the centerKey camera effect.
  useEffect(() => {
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

    // Step 7: ZOOM ONLY — fit R12 into the viewport.
    if (venueZoomLevel === 7 && venueCellR12) {
      const vport = cellFitViewport(venueCellR12, vp.w, vp.h, 24);
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

    // Step 8: NO CAMERA CHANGE — layers snap to R15 mesh + extruded board.
    // Camera stays at R12 zoom; venueZoomActiveRef is cleared by the timer effect.
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

  useEffect(() => {
    if (venueZoomActiveRef.current) return; // venue zoom controls camera during transition
    lockedZoomRef.current = target.zoom;
    setDeckVS((v) => ({
      ...v,
      longitude: target.longitude,
      latitude: target.latitude,
      zoom: target.zoom,
      pitch: target.pitch,
      bearing: 0,
      transitionDuration: TRANSITION_DURATION,
      transitionInterpolator: TRANSITION_INTERPOLATOR,
      transitionEasing: cubicInOut,
    }));
  }, [centerKey, target, tiles.size]);

  const voidH3 = useMemo(() => voidNeighborH3s(tiles), [tiles]);

  const iconFilter = useCallback(
    (t: WorldTile) =>
      t.items.length > 0 ||
      /vendor|session|lounge|booth|room|corridor/i.test(t.tileType),
    [],
  );

  const layers = useMemo(() => {
    if (tiles.size === 0) return [];
    const s = viewState.stop;

    // ── Global: R0 globe wireframe + tiny extruded board marker ──────────────
    if (s === "global") {
      const r0Cells = getRes0Cells();
      const globeLayer = createH3WireframeLayer(r0Cells, "global-r0", false, 0.35);
      // Board is sub-pixel at zoom 2 but render it for correctness.
      const boardLayer = createHexGridLayer(tiles, {
        pickable: false,
        id: "global-board",
        extruded: true,
        elevation: 10,
        opacity: 0.9,
      });
      return [globeLayer, boardLayer];
    }

    // ── Shared helper: Regional-end layers (drillLevel=5 content, stable IDs) ──
    // Called by both Regional(drillLevel=5) and Plan(venueZoomLevel=6) so that
    // deck.gl sees the same layer IDs on both sides of the stop boundary —
    // no visual change, just the camera panning.
    type MarkerDatum = { readonly h3Index: string; readonly isVenue: boolean };
    const buildRegionalEndLayers = (): ReturnType<typeof createH3WireframeLayer>[] => {
      if (!firstBoardH3 || !isValidCell(firstBoardH3)) return [];
      const r5Cell = cellToParent(firstBoardH3, 5);
      const globe = createH3WireframeLayer(getRes0Cells(), "regional-globe", false, 0.18);
      const rings = Array.from({ length: PARENT_DRILL_MAX + 1 }, (_, r) => {
        const cell = cellToParent(firstBoardH3, r);
        const opacity = 0.3 + (r / Math.max(PARENT_DRILL_MAX, 1)) * 0.6;
        return createH3WireframeLayer([cell], `regional-drill-r${r}`, false, opacity);
      });
      const r9Grid = createH3WireframeLayer(
        cellToChildren(r5Cell, 9), "regional-r9-grid", false, 0.35,
      );
      const venueR9 = cellToParent(firstBoardH3, 9);
      const landmarkR9s = PLACEHOLDER_LANDMARKS
        .map(({ lat, lng }) => latLngToCell(lat, lng, 9))
        .filter((h) => h !== venueR9);
      const markerData: MarkerDatum[] = [
        { h3Index: venueR9, isVenue: true },
        ...landmarkR9s.map((h3Index) => ({ h3Index, isVenue: false })),
      ];
      const markers = new H3HexagonLayer<MarkerDatum>({
        id: "regional-landmarks",
        data: markerData,
        pickable: false,
        extruded: true,
        elevationScale: 1,
        getElevation: () => 800,
        getHexagon: (d) => d.h3Index,
        filled: true,
        getFillColor: (d) => d.isVenue ? [0, 210, 220, 240] : [255, 160, 50, 210],
        stroked: false,
      });
      return [globe, ...rings, r9Grid, markers] as ReturnType<typeof createH3WireframeLayer>[];
    };

    // ── Regional: full drill (R0→R5 parent rings + R10→R12→board venue zoom) ───
    if (s === "regional") {
      const globeLayer = createH3WireframeLayer(getRes0Cells(), "regional-globe", false, 0.18);
      const r5Cell = firstBoardH3 && isValidCell(firstBoardH3) ? cellToParent(firstBoardH3, 5) : null;

      // Levels 0–PARENT_DRILL_MAX: nested parent ring drill
      if (drillLevel <= PARENT_DRILL_MAX) {
        const drillLayers = parentCells.map((cell, idx) => {
          const opacity = 0.3 + (idx / Math.max(PARENT_DRILL_MAX, 1)) * 0.6;
          return createH3WireframeLayer([cell], `regional-drill-r${idx}`, false, opacity);
        });
        if (drillLevel === PARENT_DRILL_MAX) {
          return buildRegionalEndLayers();
        }
        return [globeLayer, ...drillLayers];
      }

      // Levels 6–8: venue zoom
      if (drillLevel === 6 && venueR10 && r5Cell) {
        const r9Grid = createH3WireframeLayer(cellToChildren(r5Cell, 9), "r9-grid", false, 0.22);
        const r10Outline = createH3WireframeLayer([venueR10], "r10-focus", false, 0.9);
        return [globeLayer, r9Grid, r10Outline];
      }

      if (drillLevel === 7 && venueR10 && venueR12) {
        const r12Cells = cellToChildren(venueR10, 12);
        const r10Faint = createH3WireframeLayer([venueR10], "r10-faint", false, 0.25);
        const r12Grid = createH3WireframeLayer(r12Cells, "r12-grid", false, 0.5);
        return [globeLayer, r10Faint, r12Grid];
      }

      if (drillLevel >= 8 && venueR10) {
        const r12Cells = cellToChildren(venueR10, 12);
        const r12Bg = createH3WireframeLayer(r12Cells, "r12-bg", false, 0.18);
        const boardLayer = createHexGridLayer(tiles, {
          pickable: false,
          id: "regional-board",
          extruded: true,
          elevation: 3,
          opacity: 0.95,
        });
        return [r12Bg, boardLayer];
      }

      return [globeLayer];
    }

    if (s === "plan") {
      // Step 6: pan only — identical layers to Regional end-state so deck.gl
      // sees no visual change; only the camera moves.
      if (venueZoomLevel === 6) {
        return buildRegionalEndLayers();
      }

      // Step 7: zooming to R12 — show R12 wireframe, R9 context falls away
      if (venueZoomLevel === 7 && venueCellR10) {
        const r12Cells = cellToChildren(venueCellR10, 12);
        const r10Faint = createH3WireframeLayer([venueCellR10], "vz-r10f", false, 0.2);
        const r12Grid = createH3WireframeLayer(r12Cells, "vz-r12", false, 0.5);
        return [r10Faint, r12Grid];
      }

      // Step 8: camera stopped — R15 mesh fills R12 + board tiles extruded 0.5m
      if (venueZoomLevel >= 8 && venueCellR12) {
        // All 343 R15 cells in R12 as flat wireframe mesh
        const r15Grid = createH3WireframeLayer(cellToChildren(venueCellR12, 15), "vz-r15-mesh", false, 0.4);
        // Board tiles extruded 0.5m (ready for tilt later)
        const boardLayer = createHexGridLayer(tiles, {
          pickable: false,
          id: "vz-board",
          extruded: true,
          elevation: 0.5,
          opacity: 0.95,
        });
        return [r15Grid, boardLayer, createGhostPointCloudLayer(ghosts)];
      }

      // Normal Plan — no active venue zoom
      const vLayer = voidH3.length > 0
        ? [createH3WireframeLayer(voidH3, "plan-platter", false, 0.45)]
        : [];
      return [
        ...vLayer,
        createHexGridLayer(tiles, { pickable: true, id: "plan-hex", extruded: lodExtruded }),
        createGhostPointCloudLayer(ghosts),
      ];
    }

    if (s === "room" && viewState.focus) {
      const disk = cellDisk(viewState.focus, AREA_DISK_K);
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
          id: "room-world",
          extruded: false,
          opacity: 0.35,
          uniformBackdrop: { r: 28, g: 40, b: 62, a: 0.5 },
        }),
        createHexGridLayer(diskTiles, {
          pickable: true,
          id: "room-local",
          extruded: false,
          areaFocusH3: viewState.focus,
          opacity: 1,
        }),
        createTileIconLayer(iconData, "room-icons"),
        createGhostPointCloudLayer(ghosts),
        createGhostPickLayer(gpick, "room-ghost-pick", true),
      ];
    }

    if (s === "situational" && viewState.focus) {
      const g0 = ghosts.get(viewState.focus);
      if (!g0) {
        return [
          createHexGridLayer(tiles, { pickable: true, id: "plan-hex" }),
          createGhostPointCloudLayer(ghosts),
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
        }),
        createSelectionH3Layer([...disk], tiles, { id: "situational-ring" }),
        createTileIconLayer(iconData, "situational-icons"),
        createGhostPointCloudLayer(ghosts),
        createGhostPickLayer(gpick, "situational-ghost-pick", true),
      ];
    }

    return [
      createHexGridLayer(tiles, { pickable: true, id: "plan-hex", extruded: false }),
      createGhostPointCloudLayer(ghosts),
    ];
  }, [tiles, ghosts, viewState, voidH3, iconFilter, lodExtruded, parentCells, venueCellR10, venueCellR12, drillLevel, venueZoomLevel, firstBoardH3]);

  const onHover = useCallback(
    (info: { object?: unknown; x: number; y: number }) => {
      const o = info.object;
      if (!o) {
        nav.setPickTarget(null);
        setHover(null);
        return;
      }
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
        if ((viewState.stop === "plan" || viewState.stop === "room") && isWorldTile(o)) {
          nav.zoomInFromTile(o.h3Index);
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
        views={new _GlobeView({ id: "globe" })}
        viewState={deckVS}
        onViewStateChange={({ viewState: vsIn }) => {
          // All user interactions are disabled; this fires only during deck.gl transitions.
          // Pass intermediate values through unchanged so animations complete correctly.
          setDeckVS(vsIn as DeckViewState);
        }}
        controller={MAP_CONTROLLER}
        layers={layers}
        onHover={onHover}
        onClick={onClick}
        style={{ position: "absolute", top: "0", left: "0", right: "0", bottom: "0" }}
      />
      {hover ? <TileTooltip tile={hover.tile} x={hover.x} y={hover.y} /> : null}
    </div>
  );
}
