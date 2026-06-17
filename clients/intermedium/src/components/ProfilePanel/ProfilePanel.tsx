import { useCallback, useState } from "react";
import { useHumanIdentity } from "../../context/IdentityContext.js";
import { useGhostInventory } from "../../hooks/useGhostInventory.js";

interface ProfilePanelProps {
  readonly worldApiUrl: string;
}

export function ProfilePanel({ worldApiUrl }: ProfilePanelProps) {
  const identity = useHumanIdentity();
  const { items } = useGhostInventory(identity.ghostId, worldApiUrl);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(identity.displayName);

  const handleEdit = useCallback(() => {
    if (identity.displayNameLocked) return;
    setNameInput(identity.displayName);
    setEditingName(true);
  }, [identity.displayName, identity.displayNameLocked]);

  const handleSave = useCallback(() => {
    identity.setDisplayName(nameInput);
    setEditingName(false);
  }, [identity, nameInput]);

  // Group items by itemRef for display
  const grouped = items.reduce<Map<string, { name: string; qty: number }>>((acc, item) => {
    const existing = acc.get(item.itemRef);
    if (existing) {
      existing.qty += 1;
    } else {
      acc.set(item.itemRef, { name: item.name, qty: 1 });
    }
    return acc;
  }, new Map());

  return (
    <div
      className="overlay-structure"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "20px 16px",
        gap: 16,
      }}
    >
      {/* Identity section */}
      <div
        className="content-panel"
        style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "var(--tracking-label)",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          Identity
        </div>

        {editingName ? (
          <form
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            style={{ display: "flex", gap: 6 }}
          >
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={64}
              className="content-panel"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--color-text)",
                padding: "4px 8px",
                flex: 1,
                outline: "1px solid rgba(180,200,230,0.3)",
              }}
            />
            <button
              type="submit"
              className="content-panel-dim"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-dim)",
                padding: "4px 10px",
                cursor: "pointer",
                letterSpacing: "var(--tracking-label)",
              }}
            >
              Save
            </button>
          </form>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 15,
                color: "var(--color-text)",
              }}
            >
              {identity.displayName}
            </span>
            {!identity.displayNameLocked && (
              <button
                type="button"
                onClick={handleEdit}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--color-text-faint)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0 2px",
                  lineHeight: 1,
                }}
                title="Edit display name"
              >
                ✎
              </button>
            )}
          </div>
        )}

        {identity.ghostId && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--color-text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={identity.ghostId}
          >
            {identity.ghostId}
          </div>
        )}
      </div>

      {/* Bag / inventory section */}
      <div
        className="content-panel"
        style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "var(--tracking-label)",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
          }}
        >
          Bag
        </div>

        {grouped.size === 0 ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--color-text-faint)",
              paddingTop: 4,
            }}
          >
            Empty
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[...grouped.entries()].map(([ref, { name, qty }]) => (
              <div
                key={ref}
                className="content-panel-dim"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "4px 8px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--color-text-dim)",
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                  }}
                >
                  ×{qty}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
