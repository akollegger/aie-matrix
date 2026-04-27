import { useEffect, useRef, useState } from "react";
import { ClientStateProvider, useClientState } from "./context/ClientState.js";
import { PairingProvider } from "./context/PairingContext.js";
import { PanelView } from "./components/PanelView/PanelView.js";
import { PersonalPanel } from "./components/PanelView/PersonalPanel.js";
import { SceneView } from "./components/SceneView/SceneView.js";
import { PersonalScene } from "./components/PersonalScene/PersonalScene.js";
import { FailWhale } from "./components/FailWhale.js";
import { GhostArrivalOverlay } from "./components/GhostArrivalOverlay.js";
import { ReconnectingBanner } from "./components/ReconnectingBanner.js";

/** Fade duration in ms for the deck.gl ↔ R3F renderer swap (FR-028, T090). */
const FADE_MS = 200;

/**
 * Intermedium — human spectator client.
 * Switches between deck.gl (geospatial stops) and R3F (Personal stop) with a CSS fade (FR-029).
 */
function AppInner() {
  const state = useClientState();
  const stop = state.viewState.stop;

  // showPersonal tracks which renderer is mounted (lags behind `stop` by FADE_MS).
  const [showPersonal, setShowPersonal] = useState(stop === "personal");
  const [fadeOpacity, setFadeOpacity] = useState(1);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const wantPersonal = stop === "personal";
    if (wantPersonal === showPersonal) return;

    // Fade out, swap renderer, fade in (FR-028).
    setFadeOpacity(0);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setShowPersonal(wantPersonal);
      setFadeOpacity(1);
    }, FADE_MS);

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [stop, showPersonal]);

  // Find the focused ghost for the Personal scene (FR-029).
  const personalGhostId =
    stop === "personal" && state.viewState.focus ? state.viewState.focus : null;
  const personalGhost = personalGhostId ? (state.ghosts.get(personalGhostId) ?? null) : null;

  if (state.mapGramStatus === "error") {
    return <FailWhale onRetry={state.retryMapLoad} />;
  }

  return (
    <div className="app-root" data-stop={stop} aria-label="intermedium">
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100vh",
          minHeight: "100vh",
          opacity: fadeOpacity,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        {/* Deck.gl geospatial scene (all stops except Personal) */}
        {!showPersonal && (
          <>
            {state.mapGramStatus === "ready" && state.tiles.size > 0 ? <SceneView /> : null}
            {state.mapGramStatus === "loading" ? (
              <div
                style={{
                  position: "absolute",
                  top: "40%",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  color: "rgba(200, 210, 230, 0.6)",
                  fontSize: 14,
                }}
              >
                Loading world map…
              </div>
            ) : null}
            <GhostArrivalOverlay
              visible={state.mapGramStatus === "ready" && state.ghosts.size === 0}
            />
            <PanelView viewState={state.viewState} pairing={state.pairing} />
          </>
        )}

        {/* R3F Personal scene (FR-029, ADR-0006) */}
        {showPersonal && (
          <>
            <PersonalScene ghost={personalGhost} />
            <PersonalPanel />
          </>
        )}

        <ReconnectingBanner visible={state.colyseusLinkState === "reconnecting"} />
      </div>
    </div>
  );
}

export function App() {
  return (
    <PairingProvider>
      <ClientStateProvider>
        <AppInner />
      </ClientStateProvider>
    </PairingProvider>
  );
}
