/**
 * Catalog of world props we author for the freeplay map — keyed by
 * the item's class (the `ItemType` label in the gram). Each entry
 * carries a friendly name and a short description used by the
 * substrate when rendering the world snapshot into prompts.
 *
 * The world's `look` MCP tool returns each object's `id` (class)
 * and `name` (the gram-declared ItemType name). Description doesn't
 * live in the gram today, so we keep it here on the peppers side
 * for now — same place we can iterate without round-tripping the
 * world server. When the world surfaces descriptions of its own
 * we'll dissolve this catalog.
 *
 * Each prop's description should describe a SOCIAL AFFORDANCE —
 * what a ghost can do here, with whom, and why it matters. The
 * description is what ghosts have to talk about when they reach
 * the prop.
 */

export interface WorldProp {
  readonly name: string;
  readonly description: string;
}

export const WORLD_PROPS: Readonly<Record<string, WorldProp>> = {
  Bench: {
    name: "Worn Wooden Bench",
    description:
      "An old wooden bench at the edge of the path. Wide enough for two ghosts to sit together. A place to pause, slow down, and trade what you've noticed with whoever is here.",
  },
  Mural: {
    name: "Faded Mural",
    description:
      "A weathered painting on a stretch of low wall. The figures are half-erased; ghosts who have lingered here disagree about what it depicts. Worth a long look — and worth comparing theories with anyone nearby.",
  },
  Fountain: {
    name: "Stone Fountain",
    description:
      "A small fountain, water still moving. The traditional place ghosts stop when they don't know where to go next. Standing here a moment is taken as an open invitation to be approached.",
  },
  Lantern: {
    name: "Hanging Lantern",
    description:
      "A lantern hung from a wooden post. A long-standing meeting marker — travellers who don't know each other often pause beneath it. Standing under the light says: I'm willing to be met.",
  },
};

/**
 * Render an item class as `Name — description` when we have a
 * catalog entry, falling back to the bare class string otherwise.
 * Used by both the Id action stage and the Surface render to give
 * ghosts something concrete to refer to.
 */
export function describeProp(cls: string, name?: string | null): string {
  const entry = WORLD_PROPS[cls];
  if (entry) return `${entry.name} — ${entry.description}`;
  // No catalog entry: surface the world's reported name if it differs
  // from the class, else just the class. Either way the ghost has a
  // concrete handle.
  if (typeof name === "string" && name.length > 0 && name !== cls) {
    return `${name} (${cls})`;
  }
  return cls;
}

/**
 * Render the "items here" prompt line. Prefers the detailed list
 * (class + name) when the snapshot captured it; falls back to bare
 * class refs for compatibility.
 *
 *   refs:     ["Bench","Food"]
 *   detailed: [{class:"Bench",name:"Worn Wooden Bench"}, {class:"Food",name:"Crumbs"}]
 *   →  "items here:
 *         Worn Wooden Bench — An old wooden bench at the edge of the path. …
 *         Crumbs"
 */
export function renderItemsHereLine(
  refs: ReadonlyArray<string> | undefined,
  detailed: ReadonlyArray<{ class: string; name: string | null }> | undefined,
): string | null {
  if (detailed && detailed.length > 0) {
    const lines = detailed.map((d) => `  - ${describeProp(d.class, d.name)}`);
    return `items here:\n${lines.join("\n")}`;
  }
  if (refs && refs.length > 0) {
    return `items here: ${refs.join(", ")}`;
  }
  return null;
}

