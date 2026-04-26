import { useMemo } from "react";
import { useClientState } from "../../context/ClientState.js";
import { AREA_DISK_K, cellDisk, listGhostsInCells } from "../../utils/h3region.js";
import { GhostCard } from "../GhostCard/GhostCard.js";

/**
 * Area scale: ~20% width overlay; ghosts within k-ring of focused H3.
 */
export function AreaPanel() {
  const { viewState, tiles, ghosts, identities } = useClientState();
  const h3 = viewState.scale === "area" && viewState.focus ? viewState.focus : null;

  const disk = useMemo(() => (h3 ? cellDisk(h3, AREA_DISK_K) : new Set<string>()), [h3]);

  const listed = useMemo(
    () => (h3 ? listGhostsInCells(ghosts, disk) : []),
    [h3, disk, ghosts],
  );

  if (!h3) {
    return null;
  }

  return (
    <div
      data-panel="area"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: "20%",
        minWidth: 280,
        boxSizing: "border-box",
        padding: "16px 14px 24px 12px",
        overflowY: "auto",
        background: "linear-gradient(90deg, transparent 0%, rgba(6, 10, 18, 0.88) 12%, rgba(6, 10, 18, 0.92) 100%)",
        borderLeft: "1px solid rgba(100, 140, 180, 0.25)",
        zIndex: 2,
        pointerEvents: "auto",
      }}
    >
      <header style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(160, 180, 210, 0.85)", marginBottom: 12 }}>
        Nearby
      </header>
      {listed.length === 0 ? (
        <p style={{ color: "rgba(180, 200, 220, 0.7)", fontSize: 13 }}>No ghosts in this region yet.</p>
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
    </div>
  );
}
