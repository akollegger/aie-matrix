import { useCallback, useEffect, useRef, useState } from "react";
import { cellToLatLng, gridDisk, isValidCell } from "h3-js";
import type { CameraStop, ViewState } from "../types/viewState.js";
import type { HumanPairing } from "../types/ghost.js";
import type { ArrowDirection, PickTarget, ViewNavigation } from "../types/navigation.js";

const ARROW_DIRS: readonly string[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

function stepH3(h3: string, dir: ArrowDirection): string {
  const [cLat, cLng] = cellToLatLng(h3);
  const neighbors = gridDisk(h3, 1).filter(n => n !== h3);
  let best = neighbors[0]!;
  let bestScore = -Infinity;
  for (const n of neighbors) {
    const [nLat, nLng] = cellToLatLng(n);
    const score =
      dir === "ArrowUp" ? nLat - cLat :
      dir === "ArrowDown" ? cLat - nLat :
      dir === "ArrowRight" ? nLng - cLng :
      cLng - nLng;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}

export const STOP_SEQUENCE: CameraStop[] = [
  "global", "regional",
  "plan", "room", "situational", "personal",
];

export function isExteriorStop(stop: CameraStop): boolean {
  return stop === "global" || stop === "regional";
}

function nextStopInSequence(current: CameraStop, hasPairing: boolean): CameraStop | null {
  const idx = STOP_SEQUENCE.indexOf(current);
  if (idx === -1 || idx >= STOP_SEQUENCE.length - 1) return null;
  const next = STOP_SEQUENCE[idx + 1]!;
  if (next === "situational") return null; // Situational+ disabled — focusing on Plan/Room
  if (next === "personal" && !hasPairing) return null;
  return next;
}

function prevStopInSequence(current: CameraStop): CameraStop | null {
  if (current === "plan") return null; // Plan is the floor — no zooming out further
  const idx = STOP_SEQUENCE.indexOf(current);
  if (idx <= 0) return null;
  return STOP_SEQUENCE[idx - 1]!;
}

/**
 * US2: 7-stop navigation; +/= cycles forward, - cycles backward, Escape pops history;
 * double-click / Enter jumps to next meaningful stop (FR-014).
 */
export function useViewState(
  pairing: HumanPairing | null,
): { readonly viewState: ViewState; readonly nav: ViewNavigation } {
  // Plan is the default entry point — global/regional/situational/personal are
  // temporarily disabled while we focus on the Plan+Room experience.
  const initial: ViewState = { stop: "plan", focus: null };
  const [stack, setStack] = useState<ViewState[]>([initial]);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  const stopRef = useRef(initial.stop);
  const defaultFocusRef = useRef<string | null>(null);

  const viewState = stack[stack.length - 1]!;
  const hasPairing = pairing !== null;
  stopRef.current = viewState.stop;

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
      if (current.stop !== "plan") return s; // Only plan→room; room→situational disabled
      return [...s, { stop: "room", focus: h3 }];
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

  // Cycle one stop backward in the sequence (- key).
  const cycleOut = useCallback(() => {
    setStack((s) => {
      const current = s[s.length - 1]!;
      const prev = prevStopInSequence(current.stop);
      if (prev === null) return s;
      return [...s, { stop: prev, focus: null }];
    });
  }, []);

  // Return to the previous stop in history (Escape / back button).
  const zoomOut = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  // Move focus to neighboring H3 cell (Room + Situational arrow keys). Replaces top of stack (no new history entry).
  // Guards against ghost-ID focus (UUIDs are not valid H3 cells).
  // Falls back to defaultFocusRef when viewState.focus is null (e.g. cycleIn to Room with no prior focus).
  const moveFocus = useCallback((dir: ArrowDirection) => {
    setStack((s) => {
      const cur = s[s.length - 1]!;
      if (cur.stop !== "room" && cur.stop !== "situational") return s;
      const startFocus = cur.focus ?? defaultFocusRef.current;
      if (!startFocus || !isValidCell(startFocus)) return s;
      return [...s.slice(0, -1), { ...cur, focus: stepH3(startFocus, dir) }];
    });
  }, []);

  const setDefaultFocus = useCallback((h3: string | null) => {
    defaultFocusRef.current = h3;
  }, []);

  // Re-center focus on a specific tile at Room stop without changing stop (double-click re-pan).
  const relocateFocus = useCallback((h3: string) => {
    setStack((s) => {
      const cur = s[s.length - 1]!;
      if (cur.stop !== "room") return s;
      return [...s.slice(0, -1), { ...cur, focus: h3 }];
    });
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
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
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
        cycleOut();
      }
      // Arrow keys pan focus at Room and Situational stops
      if (ARROW_DIRS.includes(e.key) && (stopRef.current === "room" || stopRef.current === "situational")) {
        e.preventDefault();
        moveFocus(e.key as ArrowDirection);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomOut, triggerEnterZoom, cycleIn, cycleOut, moveFocus]);

  const nav: ViewNavigation = {
    pickTarget,
    setPickTarget,
    cycleIn,
    zoomInFromTile,
    zoomInFromGhost,
    zoomOut,
    triggerEnterZoom,
    moveFocus,
    setDefaultFocus,
    relocateFocus,
  };

  return { viewState, nav };
}
