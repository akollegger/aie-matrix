import { useEffect, useState } from "react";
import { useClientState } from "../../context/ClientState.js";
import { usePairing } from "../../context/PairingContext.js";
import { useA2AConversation } from "../../hooks/useA2AConversation.js";
import { useHumanSession } from "../../hooks/useHumanSession.js";
import { useAgentCard } from "../../hooks/useAgentCard.js";
import { useGhostInventory } from "../../hooks/useGhostInventory.js";
import { GhostList } from "./GhostList.js";
import { ChatThread } from "./ChatThread.js";
import { ChatInput } from "./ChatInput.js";
import { GhostDetailPanel } from "./GhostDetailPanel.js";

interface ChatPanelProps {
  readonly onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const { ghosts, identities } = useClientState();
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

  const ghostHouseUrl = import.meta.env.VITE_GHOST_HOUSE_URL ?? "";
  const worldApiUrl = import.meta.env.VITE_WORLD_API_URL ?? "";
  const humanId = useHumanSession();
  const { thread: rawThread, sendMessage } = useA2AConversation(selectedGhostId, worldApiUrl, humanId);
  const thread = { ...rawThread, ghostId: rawThread.ghostId ?? "" };

  const ghostIdentity = selectedGhostId ? (identities.get(selectedGhostId) ?? null) : null;
  const agentCard = useAgentCard(ghostIdentity?.agentId ?? null, ghostHouseUrl);
  const { items: inventory } = useGhostInventory(selectedGhostId, worldApiUrl);
  const isOnline = selectedGhostId != null && ghosts.has(selectedGhostId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Ghost chat"
      className="fixed inset-0 z-30 bg-surface flex flex-col p-6 box-border"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-border">
        <span className="text-xl uppercase tracking-[--tracking-label] text-text-muted">
          Ghost Chat
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="bg-transparent border border-border rounded text-text-muted text-base px-3 py-1 cursor-pointer font-mono tracking-[--tracking-label] hover:border-border-bright hover:text-text-dim transition-colors"
        >
          esc
        </button>
      </div>

      {/* Body: ghost list | chat | detail */}
      <div className="flex-1 flex gap-5 min-h-0">
        <GhostList
          identities={identities}
          ghosts={ghosts}
          selectedGhostId={selectedGhostId}
          onSelect={setSelectedGhostId}
        />

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-base uppercase tracking-[--tracking-label] text-text-muted mb-3 pb-2 border-b border-border">
            {ghostIdentity ? `${ghostIdentity.name} / ${ghostIdentity.ghostClass}` : "—"}
          </div>
          <ChatThread thread={thread} ghostIdentity={ghostIdentity} />
          <ChatInput isAvailable={thread.isAvailable && selectedGhostId != null} onSend={sendMessage} />
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
