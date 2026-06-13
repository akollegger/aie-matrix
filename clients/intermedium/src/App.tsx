import { useEffect, useRef, useState, useCallback } from "react";
import { ClientStateProvider, useClientState } from "./context/ClientState.js";
import { IdentityProvider } from "./context/IdentityContext.js";
import { useHumanIdentity } from "./context/IdentityContext.js";
import { PairingProvider } from "./context/PairingContext.js";
import { BalanceDisplay } from "./components/HUD/BalanceDisplay.js";
import { useContracts } from "./hooks/useContracts.js";
import { PanelView } from "./components/PanelView/PanelView.js";
import { PersonalPanel } from "./components/PanelView/PersonalPanel.js";
import { SceneView } from "./components/SceneView/SceneView.js";
import { PersonalScene } from "./components/PersonalScene/PersonalScene.js";
import { FailWhale } from "./components/FailWhale.js";
import { GhostArrivalOverlay } from "./components/GhostArrivalOverlay.js";
import { ReconnectingBanner } from "./components/ReconnectingBanner.js";
import { ChatPanel } from "./components/ChatPanel/ChatPanel.js";
import { NavHint } from "./components/NavHint.js";
import { LeaderboardPanel } from "./components/LeaderboardPanel/LeaderboardPanel.js";

/** Fade duration in ms for the deck.gl ↔ R3F renderer swap (FR-028, T090). */
const FADE_MS = 200;

/**
 * Intermedium — human spectator client.
 * Switches between deck.gl (geospatial stops) and R3F (Personal stop) with a CSS fade (FR-029).
 */
function AppInner() {
  const state = useClientState();
  const stop = state.viewState.stop;
  const identity = useHumanIdentity();

  // showPersonal tracks which renderer is mounted (lags behind `stop` by FADE_MS).
  const [showPersonal, setShowPersonal] = useState(stop === "personal");
  const [fadeOpacity, setFadeOpacity] = useState(1);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [leaderboardIds, setLeaderboardIds] = useState<string[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(identity.displayName);
  const [balanceRefresh, setBalanceRefresh] = useState(0);

  // Watch for contract settlement to refresh the balance display.
  const worldApiUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const { activeContract } = useContracts(worldApiUrl, identity.token, identity.ghostId);
  const prevContractStateRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevContractStateRef.current;
    const cur = activeContract?.state ?? null;
    if (prev === "Submitted" && (cur === "Settled" || cur === "Evaluated" || cur === null)) {
      setBalanceRefresh((n) => n + 1);
    }
    prevContractStateRef.current = cur;
  }, [activeContract]);

  const handleNameEdit = useCallback(() => {
    if (identity.displayNameLocked) return;
    setEditingName(true);
    setNameInput(identity.displayName);
  }, [identity.displayName, identity.displayNameLocked]);

  const handleNameSave = useCallback(() => {
    identity.setDisplayName(nameInput);
    setEditingName(false);
  }, [identity, nameInput]);

  // Fetch declared leaderboard IDs on mount via MCP `leaderboards` tool.
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!apiBase) return;
    const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;

    const load = async () => {
      try {
        const res = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "leaderboards", arguments: {} },
          }),
        });
        if (!res.ok) return;
        const envelope = (await res.json()) as {
          result?: { content?: Array<{ type: string; text?: string }> };
        };
        const textItem = envelope.result?.content?.find((c) => c.type === "text");
        if (!textItem?.text) return;
        const list = JSON.parse(textItem.text) as Array<{ id: string }>;
        if (Array.isArray(list)) {
          setLeaderboardIds(list.map((l) => l.id));
        }
      } catch {
        // world server may not be running
      }
    };

    void load();
  }, []);

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

  if (state.activeSession === null && state.mapGramStatus !== "loading") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0b0920",
          color: "rgba(200, 210, 230, 0.5)",
          gap: 12,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 32, opacity: 0.3 }}>⬡</div>
        <div style={{ fontSize: 14 }}>Waiting for session…</div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>Start a session in the map editor to begin</div>
      </div>
    );
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
            {/* Global + Regional background layers */}
            {(stop === "global" || stop === "regional") && (
              <>
                {/* Flat inky-purple base — stays as the Regional fill */}
                <div
                  className="absolute inset-0"
                  style={{ background: "#0b0920", zIndex: 0 }}
                />
                {/* Radial glow — fades out as the drill-in animation plays */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(ellipse at 50% 50%, #2a1eb8 0%, #13106b 38%, #0b0920 65%, #0b0920 100%)",
                    opacity: stop === "global" ? 1 : 0,
                    transition: "opacity 2.5s ease",
                    zIndex: 0,
                  }}
                />
              </>
            )}
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
            {(stop === "global" || stop === "regional") && leaderboardIds.length > 0 && (
              <LeaderboardPanel leaderboardIds={leaderboardIds} humanGhostId={identity.ghostId} />
            )}
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

        {/* HUD identity strip — top-left */}
        <div
          className="absolute top-3 left-3 z-10 flex flex-row items-center gap-2"
          style={{ pointerEvents: "auto" }}
        >
          {editingName ? (
            <form
              onSubmit={(e) => { e.preventDefault(); handleNameSave(); }}
              style={{ display: "flex", gap: 4 }}
            >
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={64}
                style={{
                  fontFamily: "system-ui, monospace",
                  fontSize: 12,
                  background: "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(200,230,200,0.5)",
                  borderRadius: 4,
                  color: "rgba(200,230,200,0.9)",
                  padding: "2px 6px",
                  width: 120,
                }}
              />
              <button
                type="submit"
                style={{
                  fontSize: 11,
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid rgba(200,230,200,0.3)",
                  borderRadius: 4,
                  color: "rgba(200,230,200,0.8)",
                  padding: "2px 6px",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={identity.displayNameLocked ? undefined : handleNameEdit}
              title={identity.displayNameLocked ? "Display name (locked)" : "Click to set display name"}
              style={{
                fontFamily: "system-ui, monospace",
                fontSize: 12,
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(180,200,230,0.25)",
                borderRadius: 4,
                color: "rgba(180,200,230,0.75)",
                padding: "2px 8px",
                cursor: identity.displayNameLocked ? "default" : "pointer",
              }}
            >
              {identity.displayName}
              {!identity.displayNameLocked && (
                <span style={{ opacity: 0.5, marginLeft: 4, fontSize: 10 }}>✎</span>
              )}
            </button>
          )}
          <BalanceDisplay
            token={identity.token}
            worldApiBaseUrl={import.meta.env.VITE_API_BASE_URL ?? ""}
            refreshTrigger={balanceRefresh}
          />
        </div>

        {/* Overlay corner — toasts + persistent controls, bottom-right */}
        <div className="absolute bottom-5 right-5 z-10 flex flex-col items-end gap-2">
          <NavHint visible={stop === "global"} />
          {/* Chat toggle button */}
          <button
            type="button"
            onClick={() => setChatOpen((o) => !o)}
            aria-label="Toggle ghost chat (C)"
            title="Ghost Chat [C]"
            className={[
              "font-mono text-sm uppercase tracking-[--tracking-label] px-3 py-1.5 rounded border cursor-pointer transition-colors",
              chatOpen
                ? "bg-human-bg border-border-bright text-text"
                : "bg-surface border-border text-text-dim hover:border-border-bright hover:text-text",
            ].join(" ")}
          >
            Chat [C]
          </button>
        </div>
      </div>

      {/* Full-screen chat overlay */}
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
    </div>
  );
}

export function App() {
  return (
    <IdentityProvider>
      <PairingProvider>
        <ClientStateProvider>
          <AppInner />
        </ClientStateProvider>
      </PairingProvider>
    </IdentityProvider>
  );
}
