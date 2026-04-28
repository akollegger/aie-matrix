/**
 * @see FR-022
 */
export function GhostArrivalOverlay({ visible }: { readonly visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <div
      className="ghost-arrival-overlay"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "16%",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 20,
        color: "rgba(200, 220, 255, 0.75)",
        fontSize: 15,
        letterSpacing: 0.02,
      }}
    >
      Awaiting ghost arrivals…
    </div>
  );
}
