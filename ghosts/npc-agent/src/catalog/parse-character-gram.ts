import { readFile } from "node:fs/promises";
import { Gram } from "@relateby/pattern";
import { Effect, HashSet, HashMap, Option } from "effect";
import type { Subject, Pattern } from "@relateby/pattern";
import type { Value } from "@relateby/pattern";
import type {
  BehaviorCondition,
  BehaviorRule,
  CharacterDefinition,
  CompassDirection,
  WorldAction,
  DialogEdge,
  DialogNode,
  DialogTree,
} from "../types.js";

export class CharacterParseError extends Error {
  constructor(
    readonly message: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = "CharacterParseError";
  }
}

// ── Value helpers ────────────────────────────────────────────────────────────

function strProp(props: HashMap.HashMap<string, Value>, key: string): string | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => (v._tag === "StringVal" ? v.value : undefined),
  });
}

function boolProp(props: HashMap.HashMap<string, Value>, key: string): boolean | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => (v._tag === "BoolVal" ? v.value : undefined),
  });
}

function strArrayProp(
  props: HashMap.HashMap<string, Value>,
  key: string,
): string[] | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => {
      if (v._tag !== "ArrayVal") return undefined;
      const result: string[] = [];
      for (const item of v.items) {
        if (item._tag === "StringVal") result.push(item.value);
      }
      return result;
    },
  });
}

const VALID_CONDITIONS = new Set<string>([
  "inventory_empty", "item_here", "item_adjacent", "crowded", "item_nearby", "alone", "always",
]);

const VALID_TOWARD = new Set<string>([
  "n", "s", "ne", "nw", "se", "sw", "random", "nearest_item",
]);

// ── WorldAction parser ───────────────────────────────────────────────────────

function parseWorldAction(props: HashMap.HashMap<string, Value>, doAction: string): WorldAction | null {
  switch (doAction) {
    case "go": {
      const toward = strProp(props, "toward");
      if (!toward || !VALID_TOWARD.has(toward)) return null;
      return { do: "go", toward: toward as CompassDirection | "random" | "nearest_item" };
    }
    case "take": {
      const item = (strProp(props, "item") ?? "nearest") as "nearest";
      return { do: "take", item };
    }
    case "traverse": {
      const via = strProp(props, "via");
      if (!via) return null;
      return { do: "traverse", via };
    }
    case "idle":
      return { do: "idle" };
    default:
      return null;
  }
}

// ── defaultAction string → WorldAction ──────────────────────────────────────

function parseDefaultAction(raw: string): WorldAction | null {
  switch (raw) {
    case "idle":
    case "stay":        // legacy alias
      return { do: "idle" };
    case "random-move":
    case "go-random":
      return { do: "go", toward: "random" };
    default:
      return null;
  }
}

// ── Sub-parsers ──────────────────────────────────────────────────────────────

function parseBehaviorRule(subject: Subject, index: number): BehaviorRule | null {
  const props = subject.properties;
  const when = strProp(props, "when");
  const doAction = strProp(props, "do");
  if (!when || !doAction) return null;
  if (!VALID_CONDITIONS.has(when)) return null;
  const action = parseWorldAction(props, doAction);
  if (!action) return null;
  const id = subject.identity ?? `rule-${index}`;
  return { id, condition: when as BehaviorCondition, action };
}

function parseBehaviorsBlock(elements: ReadonlyArray<Pattern<Subject>>): BehaviorRule[] {
  const rules: BehaviorRule[] = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    if (HashSet.has(el.value.labels, "Rule")) {
      const rule = parseBehaviorRule(el.value, i);
      if (rule) rules.push(rule);
    }
  }
  // Declaration order is the authoritative priority — no sort needed.
  return rules;
}

function parseDialogNode(subject: Subject): DialogNode | null {
  const id = subject.identity;
  if (!id) return null;
  const responses = strArrayProp(subject.properties, "responses");
  if (!responses || responses.length === 0) return null;
  return { id, responses };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parseCharacterGramText(
  text: string,
  source?: string,
): Effect.Effect<CharacterDefinition, CharacterParseError> {
  return Effect.gen(function* () {
    const { header, patterns } = yield* Effect.mapError(
      Gram.parseWithHeader(text),
      (e) => new CharacterParseError(e.message ?? String(e), source),
    );

    if (!header) {
      return yield* Effect.fail(new CharacterParseError("missing header record", source));
    }
    if (header["kind"] !== "matrix-character") {
      return yield* Effect.fail(
        new CharacterParseError(
          `expected kind "matrix-character", got "${String(header["kind"])}"`,
          source,
        ),
      );
    }

    // ── Collect all named blocks and nodes ───────────────────────────────────

    let characterSubject: Subject | null = null;
    const behaviorBlocks = new Map<string, BehaviorRule[]>();
    const dialogTreeEdges = new Map<string, DialogEdge[]>();
    const dialogNodes = new Map<string, DialogNode>();

    // Wire edges: character → referenced block ids
    let hasDialogTreeId: string | undefined;
    let exhibitsBehaviorId: string | undefined;

    for (const pattern of patterns) {
      const subj = pattern.value;

      // (char:Character { id, name, background, enabled, defaultAction })
      if (HashSet.has(subj.labels, "Character")) {
        characterSubject = subj;
        continue;
      }

      // [behavior_1:Behaviors | (b:Rule {...}), ...]
      if (HashSet.has(subj.labels, "Behaviors") && subj.identity) {
        behaviorBlocks.set(subj.identity, parseBehaviorsBlock(pattern.elements));
        continue;
      }

      // [dialog_1:DialogTree | (a)-[:DialogTrigger { triggers: [...] }]->(b), ...]
      if (HashSet.has(subj.labels, "DialogTree") && subj.identity) {
        const edges: DialogEdge[] = [];
        for (const el of pattern.elements) {
          if (HashSet.has(el.value.labels, "DialogTrigger") && el.elements.length === 2) {
            const fromId = el.elements[0]!.value.identity;
            const toId = el.elements[1]!.value.identity;
            if (fromId && toId) {
              const triggers = strArrayProp(el.value.properties, "triggers") ?? [];
              edges.push({ fromId, toId, triggers });
            }
          }
        }
        dialogTreeEdges.set(subj.identity, edges);
        continue;
      }

      // (node:DialogNode { responses: [...] }) — standalone node
      if (HashSet.has(subj.labels, "DialogNode")) {
        const node = parseDialogNode(subj);
        if (node) dialogNodes.set(node.id, node);
        continue;
      }

      // (char)-[:HAS_DIALOG]->(dialog_1) — top-level wiring edge
      if (HashSet.has(subj.labels, "HAS_DIALOG") && pattern.elements.length === 2) {
        hasDialogTreeId = pattern.elements[1]!.value.identity;
        continue;
      }

      // (char)-[:EXHIBITS_BEHAVIOR]->(behavior_1) — top-level wiring edge
      if (HashSet.has(subj.labels, "EXHIBITS_BEHAVIOR") && pattern.elements.length === 2) {
        exhibitsBehaviorId = pattern.elements[1]!.value.identity;
        continue;
      }
    }

    // ── Extract character fields ──────────────────────────────────────────────

    if (!characterSubject) {
      return yield* Effect.fail(
        new CharacterParseError("no Character node found", source),
      );
    }
    const charProps = characterSubject.properties;
    const id = strProp(charProps, "id")?.trim() ?? "";
    const name = strProp(charProps, "name")?.trim() ?? "";
    const background = strProp(charProps, "background")?.trim() ?? "";
    const defaultActionRaw = strProp(charProps, "defaultAction") ?? "";
    const enabled = boolProp(charProps, "enabled");

    const missing: string[] = [];
    if (!id) missing.push("id");
    if (!name) missing.push("name");
    if (!background) missing.push("background");
    if (!defaultActionRaw) missing.push("defaultAction");
    if (enabled === undefined) missing.push("enabled");
    if (missing.length > 0) {
      return yield* Effect.fail(
        new CharacterParseError(`Character missing required fields: ${missing.join(", ")}`, source),
      );
    }

    const defaultAction = parseDefaultAction(defaultActionRaw);
    if (!defaultAction) {
      return yield* Effect.fail(
        new CharacterParseError(
          `invalid defaultAction "${defaultActionRaw}": must be idle|go-random`,
          source,
        ),
      );
    }

    // ── Resolve dialog tree ───────────────────────────────────────────────────

    if (!hasDialogTreeId) {
      return yield* Effect.fail(
        new CharacterParseError(
          "no HAS_DIALOG relationship found — add (char)-[:HAS_DIALOG]->(dialog_id)",
          source,
        ),
      );
    }
    const rawEdges = dialogTreeEdges.get(hasDialogTreeId);
    if (rawEdges === undefined) {
      return yield* Effect.fail(
        new CharacterParseError(
          `HAS_DIALOG references unknown DialogTree "${hasDialogTreeId}"`,
          source,
        ),
      );
    }

    // Collect all node ids referenced in the edges.
    const referencedNodeIds = new Set<string>();
    for (const e of rawEdges) {
      referencedNodeIds.add(e.fromId);
      referencedNodeIds.add(e.toId);
    }
    for (const nodeId of referencedNodeIds) {
      if (!dialogNodes.has(nodeId)) {
        return yield* Effect.fail(
          new CharacterParseError(
            `DialogTree "${hasDialogTreeId}" references undefined DialogNode "${nodeId}"`,
            source,
          ),
        );
      }
    }

    // Find root: the node with a wildcard self-loop (triggers: []).
    const selfLoops = rawEdges.filter((e) => e.fromId === e.toId && e.triggers.length === 0);
    if (selfLoops.length === 0) {
      return yield* Effect.fail(
        new CharacterParseError(
          `DialogTree "${hasDialogTreeId}" has no idle state — add (idle)-[:DialogTrigger { triggers: [] }]->(idle)`,
          source,
        ),
      );
    }
    const rootId = selfLoops[0]!.fromId;

    const treeNodes = new Map<string, DialogNode>();
    for (const nodeId of referencedNodeIds) {
      treeNodes.set(nodeId, dialogNodes.get(nodeId)!);
    }

    const dialogTree: DialogTree = {
      id: hasDialogTreeId,
      nodes: treeNodes,
      edges: rawEdges,
      rootId,
    };

    // ── Resolve behaviors ─────────────────────────────────────────────────────

    let behaviorRules: BehaviorRule[] = [];
    if (exhibitsBehaviorId) {
      const rules = behaviorBlocks.get(exhibitsBehaviorId);
      if (rules === undefined) {
        return yield* Effect.fail(
          new CharacterParseError(
            `EXHIBITS_BEHAVIOR references unknown Behaviors block "${exhibitsBehaviorId}"`,
            source,
          ),
        );
      }
      behaviorRules = rules;
    }

    return {
      id,
      name,
      background,
      enabled: enabled!,
      defaultAction,
      behaviorRules,
      dialogTree,
    };
  });
}

export function parseCharacterGramFile(
  absolutePath: string,
): Effect.Effect<CharacterDefinition, CharacterParseError | Error> {
  return Effect.flatMap(
    Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
    (text) => parseCharacterGramText(text, absolutePath),
  );
}
