import type { GhostIdentity } from "../../types/ghost.js";
import type { GhostPosition } from "../../types/ghostPosition.js";

interface GhostListProps {
  readonly identities: ReadonlyMap<string, GhostIdentity>;
  readonly ghosts: ReadonlyMap<string, GhostPosition>;
  readonly selectedGhostId: string | null;
  readonly onSelect: (ghostId: string) => void;
}

export function GhostList({ identities, ghosts, selectedGhostId, onSelect }: GhostListProps) {
  const allIds = new Set([...identities.keys(), ...ghosts.keys()]);
  const entries = Array.from(allIds)
    .map((ghostId) => {
      const identity = identities.get(ghostId);
      return {
        ghostId,
        name: identity?.name ?? ghostId.slice(0, 12),
        ghostClass: identity?.ghostClass ?? "unknown",
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
          {entries.map(({ ghostId, name, ghostClass }) => {
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
