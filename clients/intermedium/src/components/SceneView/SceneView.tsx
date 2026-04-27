import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DeckGL from "@deck.gl/react";
import { MapView, type MapViewState, MapController } from "deck.gl";
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
  voidNeighborH3s,
  STOP_PITCH,
} from "../../utils/hexViewport.js";
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

type DeckViewState = MapViewState & { transitionDuration?: number };

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
  if (vs.stop === "neighborhood") {
    const m = mapViewFromTileBounds(tiles, w, h);
    if (m) return { ...m, pitch, bearing: 0 };
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

  const [deckVS, setDeckVS] = useState<DeckViewState>({
    longitude: target.longitude,
    latitude: target.latitude,
    zoom: target.zoom,
    pitch: target.pitch,
    bearing: 0,
  });

  useEffect(() => {
    lockedZoomRef.current = target.zoom;
    setDeckVS((v) => ({
      ...v,
      longitude: target.longitude,
      latitude: target.latitude,
      zoom: target.zoom,
      pitch: target.pitch,
      bearing: 0,
      minZoom: target.zoom,
      maxZoom: target.zoom,
      transitionDuration: 220,
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

    // Exterior stops — extruded rendering arrives in Phase 11 (T087).
    // For now, fall through to plan-style flat rendering so the app stays functional.
    if (s === "global" || s === "regional" || s === "neighborhood") {
      const vLayer =
        voidH3.length > 0
          ? [createH3WireframeLayer(voidH3, "void-wire", false, 0.55)]
          : [];
      return [
        ...vLayer,
        createHexGridLayer(tiles, { pickable: false, id: "exterior-hex" }),
      ];
    }

    if (s === "plan") {
      const vLayer =
        voidH3.length > 0
          ? [createH3WireframeLayer(voidH3, "void-wire", false, 0.55)]
          : [];
      return [
        ...vLayer,
        createHexGridLayer(tiles, { pickable: true, id: "plan-hex" }),
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
          opacity: 0.35,
          uniformBackdrop: { r: 28, g: 40, b: 62, a: 0.5 },
        }),
        createHexGridLayer(diskTiles, {
          pickable: true,
          id: "room-local",
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
          opacity: 0.3,
          uniformBackdrop: { r: 25, g: 38, b: 55, a: 0.45 },
        }),
        createHexGridLayer(diskTiles, {
          pickable: true,
          id: "situational-local",
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
      createHexGridLayer(tiles, { pickable: true, id: "plan-hex" }),
      createGhostPointCloudLayer(ghosts),
    ];
  }, [tiles, ghosts, viewState, voidH3, iconFilter]);

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
        views={new MapView({ id: "map" })}
        viewState={deckVS}
        onViewStateChange={({ viewState: vsIn }) => {
          const z = lockedZoomRef.current;
          const p = STOP_PITCH[viewState.stop];
          setDeckVS({
            ...(vsIn as MapViewState),
            pitch: p,
            bearing: 0,
            zoom: z,
            minZoom: z,
            maxZoom: z,
          } as DeckViewState);
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
