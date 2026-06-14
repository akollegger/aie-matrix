import { createLogger } from "@aie-matrix/logger";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { parseCharacterGramFile } from "./parse-character-gram.js";
import type { CharacterDefinition, NpcAgentCatalog } from "../types.js";

const log = createLogger("npc-agent");

function makeCatalog(characters: CharacterDefinition[]): NpcAgentCatalog {
  const byId = new Map(characters.map((c) => [c.id, c]));
  return {
    byId,
    enabled() {
      return Array.from(byId.values()).filter((c) => c.enabled);
    },
  };
}

/**
 * Load all `*.character.gram` files from `dir`.
 * Invalid or duplicate files are skipped with a warning; they do not abort loading.
 */
export async function loadCatalog(dir: string): Promise<NpcAgentCatalog> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    console.warn(
      JSON.stringify({ kind: "npc-agent.catalog.dir-unreadable", dir }),
    );
    return makeCatalog([]);
  }

  const gramFiles = entries.filter((f) => f.endsWith(".character.gram"));
  const characters: CharacterDefinition[] = [];
  const seenIds = new Set<string>();

  for (const file of gramFiles) {
    const absolutePath = join(dir, file);
    const result = await Effect.runPromise(
      parseCharacterGramFile(absolutePath).pipe(
        Effect.map((c) => ({ ok: true as const, character: c })),
        Effect.catchAll((e) =>
          Effect.succeed({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
        ),
      ),
    );

    if (!result.ok) {
      console.warn(
        JSON.stringify({ kind: "npc-agent.catalog.parse-failed", file, error: result.error }),
      );
      continue;
    }

    const char = result.character;
    if (seenIds.has(char.id)) {
      console.warn(
        JSON.stringify({ kind: "npc-agent.catalog.duplicate-id", id: char.id, file }),
      );
      continue;
    }

    seenIds.add(char.id);
    characters.push(char);
  }

  log.info({
    kind: "catalog.loaded",
    dir,
    total: characters.length,
    enabled: characters.filter((c) => c.enabled).length,
  });
  return makeCatalog(characters);
}
