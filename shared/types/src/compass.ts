/** Six hex faces for flat-top odd-q staggered maps (see server/world-api/README.md). */
export const COMPASS_DIRECTIONS = ["n", "s", "ne", "nw", "se", "sw"] as const;

export type Compass = (typeof COMPASS_DIRECTIONS)[number];

export function isCompass(value: string): value is Compass {
  return (COMPASS_DIRECTIONS as readonly string[]).includes(value);
}

/** `look` tool `at` argument (default `here`). */
export type LookAt = "here" | "around" | Compass;

export function isLookAt(value: string): value is LookAt {
  return value === "here" || value === "around" || isCompass(value);
}
