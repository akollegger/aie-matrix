import type { GhostIdentity } from "../../types/ghost.js";
import type { GhostPosition } from "../../types/ghostPosition.js";

interface GhostListProps {
  readonly identities: ReadonlyMap<string, GhostIdentity>;
  readonly ghosts: ReadonlyMap<string, GhostPosition>;
  readonly ghostLabels?: ReadonlyMap<string, string>;
  readonly selectedGhostId: string | null;
  readonly onSelect: (ghostId: string) => void;
}

function isBroker(labels: string | undefined): boolean {
  if (!labels) return false;
  return labels.split(",").some((l) => l.trim() === "Broker" || l.trim() === "Character:Broker");
}

export function GhostList({ identities, ghosts, ghostLabels, selectedGhostId, onSelect }: GhostListProps) {
  const allIds = new Set([...identities.keys(), ...ghosts.keys()]);
  const entries = Array.from(allIds)
    .map((ghostId) => {
      const identity = identities.get(ghostId);
      return {
        ghostId,
        name: identity?.name ?? ghostId.slice(0, 12),
        ghostClass: identity?.ghostClass ?? "unknown",
        broker: isBroker(ghostLabels?.get(ghostId)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="w-80 shrink-0 flex flex-col border-r border-border pr-4 overflow-y-auto">
      <header className="text-base uppercase tracking-[--tracking-label] text-text-muted mb-3 pb-2 border-b border-border">
        Ghosts
      </header>
      {entries.length === 0 ? (
        <p className="text-base text-text-faint italic">No ghosts active</p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-1">
          {entries.map(({ ghostId, name, ghostClass, broker }) => {
            const isOnline = ghosts.has(ghostId);
            const isSelected = ghostId === selectedGhostId;
            return (
              <li key={ghostId}>
                <button
                  type="button"
                  onClick={() => onSelect(ghostId)}
                  className={[
                    "w-full text-left rounded px-2 py-1.5 flex items-center gap-2 cursor-pointer border transition-colors",
                    isSelected
                      ? "bg-human-bg border-border-bright"
                      : "bg-transparent border-transparent hover:bg-surface-raised",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      isOnline ? "bg-online" : "bg-offline",
                    ].join(" ")}
                  />
                  <span className="flex-1 min-w-0">
                    <span
                      className={[
                        "block text-lg truncate",
                        isSelected ? "text-text" : "text-text-dim",
                      ].join(" ")}
                    >
                      {name}
                      {broker && (
                        <span
                          title="Broker — offers challenges"
                          style={{
                            marginLeft: 6,
                            fontSize: "0.7em",
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            color: "rgba(250,210,80,0.9)",
                            background: "rgba(200,150,0,0.2)",
                            border: "1px solid rgba(250,210,80,0.35)",
                            borderRadius: 3,
                            padding: "0 4px",
                            verticalAlign: "middle",
                          }}
                        >
                          BROKER
                        </span>
                      )}
                    </span>
                    <span className="block text-base text-text-faint uppercase tracking-[--tracking-label]">
                      {ghostClass}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
