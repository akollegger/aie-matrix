import { useEffect, useState } from "react";
import { useClientState } from "../../context/ClientState.js";
import { usePairing } from "../../context/PairingContext.js";
import { useHumanIdentity } from "../../context/IdentityContext.js";
import { useA2AConversation } from "../../hooks/useA2AConversation.js";
import { useAgentCard } from "../../hooks/useAgentCard.js";
import { useGhostInventory } from "../../hooks/useGhostInventory.js";
import { useContracts } from "../../hooks/useContracts.js";
import { GhostList } from "./GhostList.js";
import { ChatThread } from "./ChatThread.js";
import { ChatInput } from "./ChatInput.js";
import { GhostDetailPanel } from "./GhostDetailPanel.js";

export function ChatPanel() {
  const { ghosts, identities, ghostLabels } = useClientState();
  const pairing = usePairing();

  const defaultGhostId =
    pairing?.ghostId ??
    (identities.size > 0 ? Array.from(identities.keys())[0] ?? null : null);

  const [selectedGhostId, setSelectedGhostId] = useState<string | null>(defaultGhostId);

  useEffect(() => {
    if (selectedGhostId == null && identities.size > 0) {
      const first = pairing?.ghostId ?? Array.from(identities.keys())[0] ?? null;
      setSelectedGhostId(first);
    }
  }, [selectedGhostId, identities, pairing]);

  const ghostHouseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const worldApiUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const { ghostId: humanGhostId, token } = useHumanIdentity();
  const { thread: rawThread, sendMessage } = useA2AConversation(
    selectedGhostId,
    worldApiUrl,
    humanGhostId,
    token,
  );
  const { activeContract, submitAnswer } = useContracts(worldApiUrl, token, humanGhostId);

  const [submissionText, setSubmissionText] = useState("");
  const isContractForSelected =
    activeContract != null && activeContract.clientId === selectedGhostId;
  const thread = { ...rawThread, ghostId: rawThread.ghostId ?? "" };

  const ghostIdentity = selectedGhostId ? (identities.get(selectedGhostId) ?? null) : null;
  const agentCard = useAgentCard(ghostIdentity?.agentId ?? null, ghostHouseUrl);
  const { items: inventory } = useGhostInventory(selectedGhostId, worldApiUrl);
  const isOnline = selectedGhostId != null && ghosts.has(selectedGhostId);

  return (
    <div
      role="dialog"
      aria-label="Ghost chat"
      className="overlay-structure"
      style={{ display: "flex", flexDirection: "column", height: "100%", padding: 20, boxSizing: "border-box" }}
    >
      {/* Body: ghost list | chat | detail */}
      <div style={{ flex: 1, display: "flex", gap: 16, minHeight: 0 }}>
        <GhostList
          identities={identities}
          ghosts={ghosts}
          ghostLabels={ghostLabels}
          selectedGhostId={selectedGhostId}
          onSelect={setSelectedGhostId}
        />

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-base uppercase tracking-[--tracking-label] text-text-muted mb-3 pb-2">
            {ghostIdentity ? `${ghostIdentity.name} / ${ghostIdentity.ghostClass}` : "—"}
          </div>
          <ChatThread thread={thread} ghostIdentity={ghostIdentity} />

          {/* Inline contract UI — shown when there is an active contract with the selected ghost */}
          {isContractForSelected && activeContract.state === "Open" && (
            <div
              className="content-panel"
              style={{ marginTop: 12, padding: 12, borderLeft: "2px solid rgba(250,210,80,0.4)" }}
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
              }}
            >
              Answer submitted — waiting for evaluation…
            </div>
          )}

          {(!isContractForSelected || (activeContract.state !== "Open" && activeContract.state !== "Submitted")) && (
            <ChatInput isAvailable={thread.isAvailable && selectedGhostId != null} onSend={sendMessage} />
          )}
        </div>

        <GhostDetailPanel
          ghostIdentity={ghostIdentity}
          agentCard={agentCard}
          inventory={inventory}
          isOnline={isOnline}
        />
      </div>
    </div>
  );
}
