import { useCallback, useEffect, useState } from "react";
import type { CameraStop, ViewState } from "../types/viewState.js";
import type { HumanPairing } from "../types/ghost.js";
import type { PickTarget, ViewNavigation } from "../types/navigation.js";

export const STOP_SEQUENCE: CameraStop[] = [
  "global", "regional", "neighborhood",
  "plan", "room", "situational", "personal",
];

export function isExteriorStop(stop: CameraStop): boolean {
  return stop === "global" || stop === "regional" || stop === "neighborhood";
}

function nextStopInSequence(current: CameraStop, hasPairing: boolean): CameraStop | null {
  const idx = STOP_SEQUENCE.indexOf(current);
  if (idx === -1 || idx >= STOP_SEQUENCE.length - 1) return null;
  const next = STOP_SEQUENCE[idx + 1]!;
  if (next === "personal" && !hasPairing) return null;
  return next;
}

/**
 * US2: 7-stop navigation; zoom-in/out key cycling; Escape pops history;
 * double-click / Enter jumps to next meaningful stop (FR-014).
 *
 * TODO Phase 11: change `initial` to `"global"` once exterior-stop rendering lands.
 */
export function useViewState(
  pairing: HumanPairing | null,
): { readonly viewState: ViewState; readonly nav: ViewNavigation } {
  // Start at "plan" — exterior stops render in Phase 11.
  const initial: ViewState = { stop: "plan", focus: null };
  const [stack, setStack] = useState<ViewState[]>([initial]);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);

  const viewState = stack[stack.length - 1]!;
  const hasPairing = pairing !== null;

  const cycleIn = useCallback(() => {
    setStack((s) => {
      const current = s[s.length - 1]!;
      const next = nextStopInSequence(current.stop, hasPairing);
      if (next === null) return s;
      return [...s, { stop: next, focus: current.focus }];
    });
  }, [hasPairing]);

  const zoomInFromTile = useCallback((h3: string) => {
    setStack((s) => {
      const current = s[s.length - 1]!;
      if (current.stop !== "plan" && current.stop !== "room") return s;
      const next = current.stop === "plan" ? "room" : "situational";
      return [...s, { stop: next, focus: h3 }];
    });
  }, []);

  const zoomInFromGhost = useCallback((ghostId: string) => {
    setStack((s) => {
      const current = s[s.length - 1]!;
      if (current.stop !== "situational") return s;
      if (!hasPairing) return s;
      return [...s, { stop: "personal", focus: ghostId }];
    });
  }, [hasPairing]);

  const zoomOut = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const triggerEnterZoom = useCallback(() => {
    if (!pickTarget) return;
    if (pickTarget.type === "tile") {
      zoomInFromTile(pickTarget.h3);
    } else if (pickTarget.type === "ghost") {
      zoomInFromGhost(pickTarget.ghostId);
    }
  }, [pickTarget, zoomInFromTile, zoomInFromGhost]);

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
      // Zoom-in / zoom-out key cycling (FR-014)
      if ((e.key === "=" || e.key === "+") && !e.repeat) {
        e.preventDefault();
        cycleIn();
      }
      if (e.key === "-" && !e.repeat) {
        e.preventDefault();
        zoomOut();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomOut, triggerEnterZoom, cycleIn]);

  const nav: ViewNavigation = {
    pickTarget,
    setPickTarget,
    cycleIn,
    zoomInFromTile,
    zoomInFromGhost,
    zoomOut,
    triggerEnterZoom,
  };

  return { viewState, nav };
}
