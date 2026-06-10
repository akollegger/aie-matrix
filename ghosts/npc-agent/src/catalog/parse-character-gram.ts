import { readFile } from "node:fs/promises";
import { Gram, StandardGraph } from "@relateby/pattern";
import { Effect, HashMap, HashSet, Option } from "effect";
import type { Subject, Pattern } from "@relateby/pattern";
import type { Value } from "@relateby/pattern";
import type {
  BehaviorAction,
  BehaviorCondition,
  BehaviorRule,
  CharacterDefinition,
  DefaultAction,
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

function intProp(props: HashMap.HashMap<string, Value>, key: string): number | undefined {
  return Option.match(HashMap.get(props, key), {
    onNone: () => undefined,
    onSome: (v) => (v._tag === "IntVal" ? v.value : undefined),
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
  "inventory_empty", "crowded", "item_nearby", "alone", "always",
]);
const VALID_ACTIONS = new Set<string>([
  "seek-item", "avoid-crowd", "wander", "idle",
]);
const VALID_DEFAULT_ACTIONS = new Set<string>(["idle", "random-move", "stay"]);

// ── Node extraction ──────────────────────────────────────────────────────────

function parseBehaviorRule(subject: Subject, index: number): BehaviorRule | null {
  const props = subject.properties;
  const when = strProp(props, "when");
  const doAction = strProp(props, "do");
  if (!when || !doAction) return null;
  if (!VALID_CONDITIONS.has(when) || !VALID_ACTIONS.has(doAction)) return null;
  const id = subject.identity ?? `rule-${index}`;
  const priority = intProp(props, "priority");
  return {
    id,
    condition: when as BehaviorCondition,
    action: doAction as BehaviorAction,
    ...(priority !== undefined ? { priority } : {}),
  };
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
  const hasPriority = rules.some((r) => r.priority !== undefined);
  if (hasPriority) {
    rules.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  }
  return rules;
}

function parseDialogNode(subject: Subject): DialogNode | null {
  const props = subject.properties;
  const id = subject.identity;
  if (!id) return null;
  const responses = strArrayProp(props, "responses");
  if (!responses || responses.length === 0) return null;
  const triggerRaw = strArrayProp(props, "trigger") ?? [];
  const fallback = boolProp(props, "fallback");
  return {
    id,
    triggerConditions: triggerRaw,
    responses,
    ...(fallback ? { fallback: true } : {}),
  };
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

    const id = typeof header["id"] === "string" ? header["id"].trim() : "";
    const name = typeof header["name"] === "string" ? header["name"].trim() : "";
    const background =
      typeof header["background"] === "string" ? header["background"].trim() : "";
    const defaultActionRaw =
      typeof header["defaultAction"] === "string" ? header["defaultAction"] : "";
    const enabled =
      typeof header["enabled"] === "boolean" ? header["enabled"] : undefined;

    const missing: string[] = [];
    if (!id) missing.push("id");
    if (!name) missing.push("name");
    if (!background) missing.push("background");
    if (!defaultActionRaw) missing.push("defaultAction");
    if (enabled === undefined) missing.push("enabled");
    if (missing.length > 0) {
      return yield* Effect.fail(
        new CharacterParseError(`missing required header fields: ${missing.join(", ")}`, source),
      );
    }
    if (!VALID_DEFAULT_ACTIONS.has(defaultActionRaw)) {
      return yield* Effect.fail(
        new CharacterParseError(
          `invalid defaultAction "${defaultActionRaw}": must be idle|random-move|stay`,
          source,
        ),
      );
    }

    const behaviorRules: BehaviorRule[] = [];
    const dialogNodeMap = new Map<string, DialogNode>();
    const transitions = new Map<string, string>();

    for (const pattern of patterns) {
      const subj = pattern.value;

      // [behaviors:Behaviors | (b:Rule {...}), ...] — list block
      if (HashSet.has(subj.labels, "Behaviors") && pattern.elements.length > 0) {
        behaviorRules.push(...parseBehaviorsBlock(pattern.elements));
        continue;
      }

      // [dialog:DialogTree | (a)-[:ON]->(b), ...] — list block.
      // Each element is an edge pattern: value.labels = ["ON"], elements = [source, target].
      // StandardGraph deduplicates by identity (all ON edges have ""), so parse directly.
      if (HashSet.has(subj.labels, "DialogTree")) {
        for (const el of pattern.elements) {
          if (HashSet.has(el.value.labels, "ON") && el.elements.length === 2) {
            const source = el.elements[0]!.value.identity;
            const target = el.elements[1]!.value.identity;
            if (source && target) transitions.set(source, target);
          }
        }
        continue;
      }

      // (node:DialogNode {trigger: [...], responses: [...]}) — standalone node
      if (HashSet.has(subj.labels, "DialogNode")) {
        const node = parseDialogNode(subj);
        if (node) dialogNodeMap.set(node.id, node);
      }
    }

    // Also extract DialogNodes from the top-level graph (handles flat declarations)
    const graph = StandardGraph.fromPatterns(patterns);
    for (const [, nodePat] of graph.nodes()) {
      const nodeSubj = nodePat.value;
      if (HashSet.has(nodeSubj.labels, "DialogNode") && !dialogNodeMap.has(nodeSubj.identity)) {
        const node = parseDialogNode(nodeSubj);
        if (node) dialogNodeMap.set(node.id, node);
      }
    }

    // Apply transitions
    for (const [fromId, toId] of transitions) {
      const node = dialogNodeMap.get(fromId);
      if (node) dialogNodeMap.set(fromId, { ...node, transition: toId });
    }

    // Validate dialog tree
    if (dialogNodeMap.size === 0) {
      return yield* Effect.fail(
        new CharacterParseError("no DialogNode entries found", source),
      );
    }
    const fallbackNodes = Array.from(dialogNodeMap.values()).filter((n) => n.fallback);
    if (fallbackNodes.length !== 1) {
      return yield* Effect.fail(
        new CharacterParseError(
          `expected exactly 1 fallback DialogNode, found ${fallbackNodes.length}`,
          source,
        ),
      );
    }
    for (const node of dialogNodeMap.values()) {
      if (node.transition && !dialogNodeMap.has(node.transition)) {
        return yield* Effect.fail(
          new CharacterParseError(
            `DialogNode "${node.id}" has unresolved transition target "${node.transition}"`,
            source,
          ),
        );
      }
    }

    const fallbackNode = fallbackNodes[0]!;
    const rootNode =
      Array.from(dialogNodeMap.values()).find((n) => !n.fallback) ?? fallbackNode;

    const dialogTree: DialogTree = {
      nodes: dialogNodeMap,
      rootId: rootNode.id,
      fallbackId: fallbackNode.id,
    };

    return {
      id,
      name,
      background,
      enabled: enabled!,
      defaultAction: defaultActionRaw as DefaultAction,
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
