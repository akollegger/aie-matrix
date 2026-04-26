import { useCallback, useEffect, useState } from "react";
import type { ViewState } from "../types/viewState.js";
import type { PickTarget, ViewNavigation } from "../types/navigation.js";

const initial: ViewState = { scale: "map", focus: null };

/**
 * US2: Map → Area → Neighbor stack; Escape back; Enter zooms from `pickTarget` (FR-014).
 */
export function useViewState(): { readonly viewState: ViewState; readonly nav: ViewNavigation } {
  const [stack, setStack] = useState<ViewState[]>([initial]);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);

  const viewState = stack[stack.length - 1]!;

  const zoomInFromMapTile = useCallback((h3: string) => {
    setStack((s) => {
      if (s[s.length - 1]!.scale !== "map") {
        return s;
      }
      return [...s, { scale: "area", focus: h3 }];
    });
  }, []);

  const zoomInFromAreaGhost = useCallback((ghostId: string) => {
    setStack((s) => {
      if (s[s.length - 1]!.scale !== "area") {
        return s;
      }
      return [...s, { scale: "neighbor", focus: ghostId }];
    });
  }, []);

  const zoomOut = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const triggerEnterZoom = useCallback(() => {
    if (!pickTarget) {
      return;
    }
    if (pickTarget.type === "tile" && viewState.scale === "map") {
      zoomInFromMapTile(pickTarget.h3);
    } else if (pickTarget.type === "ghost" && viewState.scale === "area") {
      zoomInFromAreaGhost(pickTarget.ghostId);
    }
  }, [pickTarget, viewState.scale, zoomInFromMapTile, zoomInFromAreaGhost]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        zoomOut();
      }
      if (e.key === "Enter" && !e.repeat) {
        e.preventDefault();
        triggerEnterZoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomOut, triggerEnterZoom]);

  const nav: ViewNavigation = {
    pickTarget,
    setPickTarget,
    zoomInFromMapTile,
    zoomInFromAreaGhost,
    zoomOut,
    triggerEnterZoom,
  };

  return { viewState, nav };
}
