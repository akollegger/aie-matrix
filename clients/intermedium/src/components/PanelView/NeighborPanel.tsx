import { useMemo } from "react";
import { useClientState } from "../../context/ClientState.js";
import { NEIGHBOR_DISK_K, cellDisk, listGhostsInCells } from "../../utils/h3region.js";
import { GhostCard } from "../GhostCard/GhostCard.js";

/**
 * Neighbor scale: ~50% width overlay; 7-hex proximity + optional paired thread stub.
 */
export function NeighborPanel() {
  const { viewState, tiles, ghosts, identities, pairing } = useClientState();
  const focusGid = viewState.scale === "neighbor" && viewState.focus ? viewState.focus : null;
  const focusGhost = focusGid ? ghosts.get(focusGid) : undefined;

  const disk = useMemo(
    () => (focusGhost ? cellDisk(focusGhost.h3Index, NEIGHBOR_DISK_K) : new Set<string>()),
    [focusGhost?.h3Index],
  );

  const listed = useMemo(
    () => (focusGhost ? listGhostsInCells(ghosts, disk) : []),
    [focusGhost, disk, ghosts],
  );

  const pairedInCluster = useMemo(() => {
    if (!pairing) {
      return false;
    }
    return listed.some((x) => x.id === pairing.ghostId);
  }, [pairing, listed]);

  if (!focusGid || !focusGhost) {
    return null;
  }

  return (
    <div
      data-panel="neighbor"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: "50%",
        minWidth: 320,
        maxWidth: "min(720px, 55vw)",
        boxSizing: "border-box",
        padding: "16px 20px 24px 16px",
        overflowY: "auto",
        background: "linear-gradient(90deg, transparent 0%, rgba(4, 8, 16, 0.9) 8%, rgba(4, 8, 16, 0.94) 100%)",
        borderLeft: "1px solid rgba(100, 140, 180, 0.3)",
        zIndex: 2,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <section>
        <header style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(160, 180, 210, 0.85)", marginBottom: 12 }}>
          Proximity
        </header>
        {listed.length === 0 ? (
          <p style={{ color: "rgba(180, 200, 220, 0.7)", fontSize: 13 }}>No other ghosts in this cluster.</p>
        ) : (
          listed.map(({ id, g }) => {
            const idn = identities.get(id);
            const t = tiles.get(g.h3Index) ?? null;
            return (
              <GhostCard
                key={id}
                name={idn?.name ?? id}
                className={idn?.ghostClass ?? "—"}
                tile={t}
                position={g}
              />
            );
          })
        )}
      </section>
      {pairedInCluster ? (
        <section
          style={{
            borderTop: "1px solid rgba(100, 140, 180, 0.25)",
            paddingTop: 12,
          }}
        >
          <header style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(160, 180, 210, 0.85)", marginBottom: 8 }}>
            Paired thread
          </header>
          <p style={{ color: "rgba(180, 200, 220, 0.75)", fontSize: 13, margin: 0 }}>
            Conversation view unlocks at Partner scale (US3).
          </p>
        </section>
      ) : null}
    </div>
  );
}
