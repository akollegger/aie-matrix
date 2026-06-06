import type { CSSProperties } from "react"
import type { LeaderboardSpec } from "../../types/map-gram.js"

export interface LeaderboardDefinitionCardProps {
  spec: LeaderboardSpec
}

const card: CSSProperties = {
  margin: "4px 8px",
  padding: "6px 8px",
  background: "#13132a",
  border: "1px solid #2a2a3e",
  borderRadius: 4,
}

const titleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#aabbd4",
  marginBottom: 2,
}

const descStyle: CSSProperties = {
  fontSize: 10,
  color: "#667",
  marginBottom: 4,
  lineHeight: 1.4,
}

const fieldRow: CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 2,
  alignItems: "baseline",
}

const fieldLabel: CSSProperties = {
  fontSize: 9,
  color: "#445",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  minWidth: 72,
  flexShrink: 0,
}

const fieldValue: CSSProperties = {
  fontSize: 10,
  color: "#99aacc",
  fontFamily: "monospace",
  wordBreak: "break-all",
}

export function LeaderboardDefinitionCard({ spec }: LeaderboardDefinitionCardProps) {
  return (
    <div style={card}>
      <div style={titleStyle}>{spec.title}</div>
      {spec.description && <div style={descStyle}>{spec.description}</div>}
      <div style={fieldRow}>
        <span style={fieldLabel}>ID</span>
        <span style={fieldValue}>{spec.id}</span>
      </div>
      <div style={fieldRow}>
        <span style={fieldLabel}>Resource</span>
        <span style={fieldValue}>{spec.resource}</span>
      </div>
      <div style={fieldRow}>
        <span style={fieldLabel}>Aggregation</span>
        <span style={fieldValue}>{spec.aggregation}</span>
      </div>
      <div style={fieldRow}>
        <span style={fieldLabel}>Direction</span>
        <span style={fieldValue}>{spec.direction}</span>
      </div>
      <div style={fieldRow}>
        <span style={fieldLabel}>Actor Kind</span>
        <span style={fieldValue}>{spec.actorKind}</span>
      </div>
      {spec.cause && (
        <div style={fieldRow}>
          <span style={fieldLabel}>Cause</span>
          <span style={fieldValue}>{spec.cause}</span>
        </div>
      )}
    </div>
  )
}
