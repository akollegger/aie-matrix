import { useClientState } from "../../context/ClientState.js";
import { useA2AConversation } from "../../hooks/useA2AConversation.js";
import { useHumanSession } from "../../hooks/useHumanSession.js";
import { ConversationThread } from "../ConversationThread/ConversationThread.js";
import { MessageInput } from "../ConversationThread/MessageInput.js";
import { GhostCard } from "../GhostCard/GhostCard.js";

/**
 * Personal stop: ~80% width overlay — ghost status, conversation thread, message input (FR-009).
 * No separate mini-map column; the R3F scene fills the remainder (ADR-0006).
 */
export function PersonalPanel() {
  const { viewState, ghosts, tiles, identities, pairing } = useClientState();
  const ghostId = pairing?.ghostId ?? null;
  const ghost = ghostId ? (ghosts.get(ghostId) ?? null) : null;
  const identity = ghostId ? (identities.get(ghostId) ?? null) : null;
  const tile = ghost ? (tiles.get(ghost.h3Index) ?? null) : null;

  const worldApiUrl = import.meta.env.VITE_WORLD_API_URL ?? "";
  const humanId = useHumanSession();
  const { thread: rawThread, sendMessage } = useA2AConversation(
    viewState.stop === "personal" ? ghostId : null,
    worldApiUrl,
    humanId,
  );
  const thread = { ...rawThread, ghostId: rawThread.ghostId ?? "" };

  return (
    <div
      data-panel="personal"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: "80%",
        minWidth: 320,
        maxWidth: 680,
        boxSizing: "border-box",
        padding: "20px 20px 20px 16px",
        overflowY: "auto",
        background:
          "linear-gradient(90deg, transparent 0%, rgba(4, 8, 18, 0.92) 6%, rgba(4, 8, 18, 0.96) 100%)",
        borderLeft: "1px solid rgba(80, 120, 180, 0.3)",
        zIndex: 2,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Ghost status */}
      {ghost && (
        <section>
          <header
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "rgba(140, 170, 210, 0.75)",
              marginBottom: 8,
            }}
          >
            Ghost
          </header>
          <GhostCard
            name={identity?.name ?? (ghostId ?? "—")}
            className={identity?.ghostClass ?? "—"}
            tile={tile}
            position={ghost}
          />
        </section>
      )}

      {/* Conversation thread */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <header
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "rgba(140, 170, 210, 0.75)",
          }}
        >
          Conversation
        </header>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <ConversationThread thread={thread} />
        </div>
        <MessageInput isAvailable={thread.isAvailable} onSend={sendMessage} />
      </section>
    </div>
  );
}
