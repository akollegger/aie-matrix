/**
 * Interiority annotation labels rendered as an HTML overlay next to the R3F canvas.
 * Content stubs pending IC-004 (ghost house read API). Copy is observability-first; not game-quest phrasing.
 * @see FR-012, FR-029
 */
export function GhostInteriorityOverlay() {
  const container: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    right: "5%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    pointerEvents: "none",
  };

  const label: React.CSSProperties = {
    color: "rgba(180, 210, 240, 0.75)",
    fontSize: 11,
    fontFamily: "monospace",
    whiteSpace: "nowrap",
    background: "rgba(4, 8, 18, 0.55)",
    padding: "4px 8px",
    borderRadius: 3,
    borderLeft: "2px solid rgba(100, 150, 200, 0.5)",
  };

  const heading: React.CSSProperties = {
    color: "rgba(120, 170, 210, 0.6)",
    fontSize: 9,
    marginBottom: 2,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  const stub: React.CSSProperties = {
    color: "rgba(200, 215, 230, 0.45)",
    fontStyle: "italic",
  };

  return (
    <div style={container}>
      <div style={label}>
        <div style={heading}>Carrying</div>
        <div style={stub}>— awaiting data —</div>
      </div>
      <div style={label}>
        <div style={heading}>Active goal</div>
        <div style={stub}>— awaiting data —</div>
      </div>
      <div style={label}>
        <div style={heading}>Recalls</div>
        <div style={stub}>— awaiting data —</div>
      </div>
    </div>
  );
}
