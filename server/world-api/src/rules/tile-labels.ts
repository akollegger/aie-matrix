/**
 * Map tile "class" strings from Tiled types into label sets for rule matching.
 * Multi-label convention: colon-separated tokens (e.g. `VIP:Hallway`).
 */
export function tileLabelsFromClass(tileClass: string): ReadonlySet<string> {
  const trimmed = tileClass.trim();
  if (!trimmed) {
    return new Set(["Tile"]);
  }
  const parts = trimmed
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(parts.length > 0 ? parts : [trimmed]);
}
