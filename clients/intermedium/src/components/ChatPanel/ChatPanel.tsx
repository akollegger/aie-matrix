import { useCallback, useEffect, useRef, useState } from "react";
import { useClientState } from "../../context/ClientState.js";
import { usePairing } from "../../context/PairingContext.js";
import { useHumanIdentity } from "../../context/IdentityContext.js";
import { useA2AConversation } from "../../hooks/useA2AConversation.js";
import { useAgentCard } from "../../hooks/useAgentCard.js";
import { useGhostInventory } from "../../hooks/useGhostInventory.js";
import { useContracts } from "../../hooks/useContracts.js";
import { ThreadPills } from "./ThreadPills.js";
import type { ThreadSlot } from "./ThreadPills.js";
import { ChatThread } from "./ChatThread.js";
import { ChatInput } from "./ChatInput.js";
import { GhostDetailPanel } from "./GhostDetailPanel.js";

interface ChatPanelProps {
  readonly ghostClickRequest?: string | null;
  readonly onGhostClickHandled?: () => void;
  readonly onSelectedGhostChange?: (ghostId: string | null) => void;
}

export function ChatPanel({ ghostClickRequest, onGhostClickHandled, onSelectedGhostChange }: ChatPanelProps) {
  const { ghosts, identities, ghostGlyphs } = useClientState();
  const pairing = usePairing();

  const [threads, setThreads] = useState<ThreadSlot[]>(() => {
    if (pairing?.ghostId) return [{ ghostId: pairing.ghostId, isPermanent: true }];
    return [];
  });
  const [activeGhostId, setActiveGhostId] = useState<string | null>(pairing?.ghostId ?? null);

  const openThread = useCallback((ghostId: string) => {
    setThreads((prev) => {
      if (prev.some((t) => t.ghostId === ghostId)) return prev;
      return [...prev, { ghostId, isPermanent: false }];
    });
    setActiveGhostId(ghostId);
  }, []);

  const promoteThread = useCallback((ghostId: string) => {
    setThreads((prev) =>
      prev.map((t) => t.ghostId === ghostId ? { ...t, isPermanent: true } : t),
    );
  }, []);

  const closeThread = useCallback((ghostId: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.ghostId !== ghostId);
      return next;
    });
    setActiveGhostId((cur) => {
      if (cur !== ghostId) return cur;
      const remaining = threads.filter((t) => t.ghostId !== ghostId);
      return remaining[remaining.length - 1]?.ghostId ?? null;
    });
  }, [threads]);

  // Notify parent of active ghost changes (for scene highlight)
  const onSelectedGhostChangeRef = useRef(onSelectedGhostChange);
  onSelectedGhostChangeRef.current = onSelectedGhostChange;
  useEffect(() => {
    onSelectedGhostChangeRef.current?.(activeGhostId);
  }, [activeGhostId]);

  // Consume ghost click from scene
  useEffect(() => {
    if (!ghostClickRequest) return;
    openThread(ghostClickRequest);
    onGhostClickHandled?.();
  }, [ghostClickRequest, openThread, onGhostClickHandled]);

  const ghostHouseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const worldApiUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const { ghostId: humanGhostId, token } = useHumanIdentity();
  const { thread: rawThread, sendMessage: rawSendMessage } = useA2AConversation(
    activeGhostId,
    worldApiUrl,
    humanGhostId,
    token,
  );
  const { activeContract, submitAnswer } = useContracts(worldApiUrl, token, humanGhostId);

  // Promote thread whenever the active conversation gets its first message (either direction).
  // This covers: human sends (via sendMessage below), ghost sends proactively, or existing history loads.
  useEffect(() => {
    if (activeGhostId && rawThread.messages.length > 0) {
      promoteThread(activeGhostId);
    }
  }, [activeGhostId, rawThread.messages.length, promoteThread]);

  const sendMessage = useCallback(async (text: string) => {
    if (!activeGhostId) return;
    promoteThread(activeGhostId);
    await rawSendMessage(text);
  }, [activeGhostId, promoteThread, rawSendMessage]);

  const [infoGhostId, setInfoGhostId] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState("");
  const isContractForSelected =
    activeContract != null && activeContract.clientId === activeGhostId;
  const thread = { ...rawThread, ghostId: rawThread.ghostId ?? "" };

  const ghostIdentity = activeGhostId ? (identities.get(activeGhostId) ?? null) : null;
  const infoIdentity = infoGhostId ? (identities.get(infoGhostId) ?? null) : null;
  const agentCard = useAgentCard((infoIdentity ?? ghostIdentity)?.agentId ?? null, ghostHouseUrl);
  const { items: inventory } = useGhostInventory(infoGhostId ?? activeGhostId, worldApiUrl);
  const infoIsOnline = infoGhostId != null && ghosts.has(infoGhostId);

  return (
    <div
      role="dialog"
      aria-label="Ghost chat"
      className="overlay-structure"
      style={{ display: "flex", flexDirection: "column", height: "100%", boxSizing: "border-box", pointerEvents: "none" }}
    >
      <div style={{ pointerEvents: "auto", position: "relative" }}>
        <ThreadPills
          threads={threads}
          activeGhostId={activeGhostId}
          ghosts={ghosts}
          identities={identities}
          ghostGlyphs={ghostGlyphs}
          infoGhostId={infoGhostId}
          onSelect={setActiveGhostId}
          onClose={closeThread}
          onInfo={setInfoGhostId}
        />
        {infoGhostId && infoIdentity && (
          <GhostDetailPanel
            ghostIdentity={infoIdentity}
            agentCard={agentCard}
            inventory={inventory}
            isOnline={infoIsOnline}
            glyph={ghostGlyphs.get(infoGhostId)}
            onClose={() => setInfoGhostId(null)}
          />
        )}
      </div>

      {/* Body: chat — pointer-events: none so transparent areas pass clicks to the scene */}
      <div style={{ flex: 1, display: "flex", gap: 16, minHeight: 0, padding: "12px 20px 0", pointerEvents: "none" }}>
        {/* Chat area — none by default so ghost dots behind transparent space remain clickable */}
        <div className="flex-1 flex flex-col min-w-0" style={{ pointerEvents: "none" }}>
          <div style={{ pointerEvents: "none", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ChatThread thread={thread} ghostIdentity={ghostIdentity} />
          </div>

          {isContractForSelected && activeContract.state === "Open" && (
            <div
              className="content-panel"
              style={{ marginTop: 12, padding: 12, borderLeft: "2px solid rgba(250,210,80,0.4)", pointerEvents: "auto" }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "rgba(250,210,120,0.9)", fontWeight: 600 }}>
                Challenge from {ghostIdentity?.name ?? "broker"}
              </p>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-dim)" }}>
                {activeContract.request}
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!submissionText.trim()) return;
                  await submitAnswer(activeContract.id, submissionText.trim());
                  setSubmissionText("");
                }}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <textarea
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  placeholder="Your answer…"
                  rows={3}
                  className="content-panel-dim"
                  style={{
                    resize: "vertical",
                    fontFamily: "system-ui, sans-serif",
                    fontSize: 13,
                    color: "var(--color-text)",
                    padding: "6px 8px",
                    width: "100%",
                  }}
                />
                <button
                  type="submit"
                  disabled={!submissionText.trim()}
                  className="content-panel-dim"
                  style={{
                    alignSelf: "flex-end",
                    fontSize: 12,
                    padding: "4px 14px",
                    color: "rgba(250,220,100,0.9)",
                    cursor: submissionText.trim() ? "pointer" : "default",
                    opacity: submissionText.trim() ? 1 : 0.4,
                  }}
                >
                  Submit
                </button>
              </form>
            </div>
          )}

          {isContractForSelected && activeContract.state === "Submitted" && (
            <div
              className="content-panel-dim"
              style={{
                marginTop: 12,
                padding: 10,
                fontSize: 12,
                color: "var(--color-text-dim)",
                borderLeft: "2px solid var(--color-border-bright)",
                pointerEvents: "auto",
              }}
            >
              Answer submitted — waiting for evaluation…
            </div>
          )}

          {(!isContractForSelected || (activeContract.state !== "Open" && activeContract.state !== "Submitted")) && (
            <div style={{ pointerEvents: "auto" }}>
              <ChatInput isAvailable={thread.isAvailable && activeGhostId != null} onSend={sendMessage} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
