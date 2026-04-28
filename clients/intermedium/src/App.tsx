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
import { ChatPanel } from "./components/ChatPanel/ChatPanel.js";

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
  const [chatOpen, setChatOpen] = useState(false);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setChatOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

        {/* Chat toggle button — bottom-right corner */}
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          aria-label="Toggle ghost chat (C)"
          title="Ghost Chat [C]"
          style={{
            position: "absolute",
            bottom: 20,
            right: 20,
            zIndex: 10,
            background: chatOpen ? "rgba(60, 100, 160, 0.6)" : "rgba(20, 30, 50, 0.7)",
            border: "1px solid rgba(100, 140, 180, 0.4)",
            borderRadius: 6,
            color: "rgba(180, 210, 255, 0.9)",
            fontSize: 11,
            padding: "6px 12px",
            cursor: "pointer",
            fontFamily: "monospace",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Chat [C]
        </button>
      </div>

      {/* Full-screen chat overlay */}
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
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
