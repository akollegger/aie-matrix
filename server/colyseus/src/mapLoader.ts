import { readFile } from "node:fs/promises";
import type { LoadedMap } from "./mapTypes.js";

export class MapLoadError extends Error {
  override readonly name = "MapLoadError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Load a `.map.gram` hex map file into a compass-labeled graph keyed by H3 res-15 indices.
 *
 * The `options` parameter is accepted for call-site compatibility but is unused — gram files
 * include all map data (items, portals, rules) inline.
 */
export async function loadHexMap(
  gramAbsolutePath: string,
  _options?: { itemsPath?: string },
): Promise<LoadedMap> {
  const gramText = await readFile(gramAbsolutePath, "utf8");
  const { loadGramMap } = await import("./mapLoader.gram.js");
  const { MapGramParseError } = await import("@aie-matrix/map-gram");
  try {
    return await loadGramMap(gramText);
  } catch (e) {
    if (e instanceof MapGramParseError) {
      throw new MapLoadError(`${gramAbsolutePath}: ${e.detail ?? e.reason}`);
    }
    throw e;
  }
}
