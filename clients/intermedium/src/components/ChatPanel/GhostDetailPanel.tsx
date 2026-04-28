import type { GhostIdentity } from "../../types/ghost.js";
import type { AgentCardDetail } from "../../hooks/useAgentCard.js";
import type { InventoryItem } from "../../hooks/useGhostInventory.js";

interface GhostDetailPanelProps {
  readonly ghostIdentity: GhostIdentity | null;
  readonly agentCard: AgentCardDetail | null;
  readonly inventory: readonly InventoryItem[];
  readonly isOnline: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="text-base uppercase tracking-[--tracking-label] text-text-muted pb-1 border-b border-border">
        {title}
      </header>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-base">
      <span className="text-text-faint w-24 shrink-0">{label}</span>
      <span className="text-text-dim break-all">{value || "—"}</span>
    </div>
  );
}

export function GhostDetailPanel({ ghostIdentity, agentCard, inventory, isOnline }: GhostDetailPanelProps) {
  if (!ghostIdentity) {
    return (
      <aside className="w-96 shrink-0 flex items-center justify-center border-l border-border pl-5">
        <p className="text-base text-text-faint italic">Select a ghost</p>
      </aside>
    );
  }

  return (
    <aside className="w-96 shrink-0 flex flex-col gap-5 border-l border-border pl-5 overflow-y-auto">
      {/* Ghost identity */}
      <Section title="Ghost">
        <div className="flex items-center gap-2 mb-1">
          <span className={["w-2 h-2 rounded-full shrink-0", isOnline ? "bg-online" : "bg-offline"].join(" ")} />
          <span className="text-lg text-text font-semibold truncate">{ghostIdentity.name}</span>
        </div>
        <Row label="ghost id" value={ghostIdentity.ghostId.slice(0, 20) + "…"} />
        <Row label="tier" value={ghostIdentity.ghostClass} />
        {agentCard && <Row label="agent" value={agentCard.name} />}
        {agentCard?.version && <Row label="version" value={agentCard.version} />}
        {agentCard?.llmProvider && <Row label="model" value={agentCard.llmProvider} />}
        {agentCard?.memoryKind && <Row label="memory" value={agentCard.memoryKind} />}
      </Section>

      {/* Agent description */}
      {agentCard?.description && (
        <Section title="About">
          <p className="text-base text-text-dim leading-relaxed">{agentCard.description}</p>
        </Section>
      )}

      {/* Tools */}
      {agentCard && agentCard.requiredTools.length > 0 && (
        <Section title="Tools">
          <div className="flex flex-wrap gap-1">
            {agentCard.requiredTools.map((t) => (
              <span
                key={t}
                className="text-base font-mono bg-surface-raised border border-border rounded px-1.5 py-0.5 text-text-dim"
              >
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Inventory */}
      <Section title="Carrying">
        {inventory.length === 0 ? (
          <p className="text-base text-text-faint italic">Nothing</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {inventory.map((item) => (
              <li key={item.itemRef} className="flex items-baseline gap-2 text-base">
                <span className="text-text-muted font-mono">·</span>
                <span className="text-text-dim">{item.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
