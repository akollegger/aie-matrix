/** Shared check for PoC “verbose server” style flags (trim + case-insensitive). */
export function isEnvTruthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
