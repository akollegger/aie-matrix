/**
 * @see FR-021
 */
export function ReconnectingBanner({ visible }: { readonly visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <div
      className="reconnecting-banner"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "6px 12px",
        background: "rgba(20, 24, 32, 0.88)",
        color: "rgba(255, 200, 120, 0.95)",
        fontSize: 12,
        textAlign: "center",
        zIndex: 40,
        borderBottom: "1px solid rgba(255, 180, 80, 0.25)",
      }}
    >
      Reconnecting…
    </div>
  );
}
