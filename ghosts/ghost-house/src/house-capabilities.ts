/**
 * House-side capabilities for `matrix.capabilitiesRequired` validation (T044).
 * Extend with new symbols as optional integrations are added.
 */
export function readHouseCapabilityManifest(): Set<string> {
  const s = new Set<string>();
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) {
    s.add("telemetry.otlp");
  }
  return s;
}
