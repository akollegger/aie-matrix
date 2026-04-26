import { ClientStateProvider, useClientState } from "./context/ClientState.js";
import { PairingProvider } from "./context/PairingContext.js";
import { PanelView } from "./components/PanelView/PanelView.js";
import { SceneView } from "./components/SceneView/SceneView.js";
import { FailWhale } from "./components/FailWhale.js";
import { GhostArrivalOverlay } from "./components/GhostArrivalOverlay.js";
import { ReconnectingBanner } from "./components/ReconnectingBanner.js";

/**
 * Intermedium — human spectator client (Map scale: deck.gl + live ghost tiles).
 */
function AppInner() {
  const state = useClientState();

  if (state.mapGramStatus === "error") {
    return <FailWhale onRetry={state.retryMapLoad} />;
  }

  return (
    <div className="app-root" data-scale={state.viewState.scale} aria-label="intermedium">
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100vh",
          minHeight: "100vh",
        }}
      >
        {state.mapGramStatus === "ready" && state.tiles.size > 0 ? <SceneView /> : null}
        {state.mapGramStatus === "loading" ? (
          <div
            style={{
              position: "absolute",
              top: "40%",
              left: "0",
              right: "0",
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
        <ReconnectingBanner visible={state.colyseusLinkState === "reconnecting"} />
        <PanelView viewState={state.viewState} pairing={state.pairing} />
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
