import { useEffect, useRef } from "react";
import type { GhostIdentity } from "../../types/ghost.js";
import type { AgentCardDetail } from "../../hooks/useAgentCard.js";
import type { InventoryItem } from "../../hooks/useGhostInventory.js";

interface GhostDetailPanelProps {
  readonly ghostIdentity: GhostIdentity | null;
  readonly agentCard: AgentCardDetail | null;
  readonly inventory: readonly InventoryItem[];
  readonly isOnline: boolean;
  readonly glyph?: string;
  readonly onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
      <span style={{ color: "var(--color-text-faint)", width: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--color-text-dim)", wordBreak: "break-all" }}>{value || "—"}</span>
    </div>
  );
}

export function GhostDetailPanel({ ghostIdentity, agentCard, inventory, isOnline, glyph, onClose }: GhostDetailPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      // Ignore clicks on the toggle button itself — its onClick handles open/close.
      if (target?.closest("[data-ghost-info-toggle]")) return;
      if (ref.current && !ref.current.contains(target)) {
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation(); // prevent HUD from also closing
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  if (!ghostIdentity) return null;

  return (
    <div
      ref={ref}
      className="content-panel"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 200,
        minWidth: 260,
        maxWidth: 340,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: isOnline ? "var(--color-online)" : "var(--color-offline)",
        }} />
        {glyph && <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>{glyph}</span>}
        <span style={{ color: "var(--color-text)", fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ghostIdentity.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--color-text-faint)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}
          title="Close"
        >×</button>
      </div>

      {/* Identity rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Row label="ghost id" value={ghostIdentity.ghostId.slice(0, 20) + "…"} />
        {agentCard && <Row label="agent" value={agentCard.name} />}
        {agentCard?.version && <Row label="version" value={agentCard.version} />}
        {agentCard?.llmProvider && <Row label="model" value={agentCard.llmProvider} />}
        {agentCard?.memoryKind && <Row label="memory" value={agentCard.memoryKind} />}
      </div>

      {/* About */}
      {agentCard?.description && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-dim)", lineHeight: 1.5, borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
          {agentCard.description}
        </p>
      )}

      {/* Inventory */}
      {inventory.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: 4 }}>Carrying</div>
          {inventory.map((item) => (
            <div key={item.itemRef} style={{ fontSize: 12, color: "var(--color-text-dim)", paddingLeft: 4 }}>· {item.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
