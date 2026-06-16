/**
 * Raw passthrough of the underlying neo4j-agent-memory MCP tools to
 * both the Id (via @openai/agents SDK) and the Surface (via
 * chatToolsStatefulLoop's recall path).
 *
 * The model sees the real MCP schemas and calls the real MCP tools.
 * We hide a small set of tools the LLM has no business touching —
 * trace machinery (we own those write paths) and any maintenance /
 * indexing ops — but everything else, including raw `graph_query`
 * (Cypher), is exposed. The user wanted full access, including the
 * footgun, for behavioural observation.
 *
 * Output is the MCP result's text content concatenated (matches how
 * the Agent Memory MCP returns most calls), capped at a sane size
 * so a runaway search or Cypher query can't blow the context. The
 * cap shows as a "[truncated]" marker so the model knows it
 * exists.
 */

import { tool } from "@openai/agents";

import type { MemoryClient } from "@aie-matrix/ghost-peppers-mem";

import type { ToolSchema } from "../../llm-client.js";
import type { CascadeContext } from "../cascade-context.js";
import { asNonStrictSchema } from "./schema-helpers.js";

/** Tools we DO NOT expose to the model.
 *  - Trace machinery: the substrate writes traces around every
 *    cascade automatically. If the LLM also writes to them, the
 *    trace structure breaks.
 *  - Maintenance: indexes, schema migrations, profile bootstraps
 *    are operator tools.
 *
 *  Everything else — read, search, write-fact, store-message,
 *  preferences, entities, edges, raw Cypher — is fair game. */
const HIDDEN_AGENT_MEMORY_TOOLS: ReadonlySet<string> = new Set([
  "memory_start_trace",
  "memory_complete_trace",
  "memory_record_step",
  "memory_init_schema",
  "memory_create_indexes",
  "memory_drop_indexes",
  "memory_setup",
]);

/**
 * Ghost-relevant descriptions for each agent-memory tool. We replace
 * the upstream descriptions (written for generic LLM agents) with
 * descriptions framed in terms of what the ghost would actually use
 * the tool FOR. A tool the model perceives as "administrative" gets
 * ignored; a tool framed as "what you remember" gets reached for.
 *
 * Unmapped tools fall through to the upstream description; the
 * coverage check in `getAgentMemoryToolSchemas` warns if anything
 * new has appeared upstream that needs a translation.
 */
const TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  memory_search:
    "Search what you remember. Use this when something feels familiar — a name you might know, a topic you might have discussed before, a place you've been. Pass a phrase to look for; you get back matches across what you've said, the people you've noted, and the facts you've written down.",
  memory_get_context:
    "Gather relevant pieces of what you remember about a topic. Use this when you're about to make a decision and want to ground it in what you already know — broader than a search, more like a brief assembling everything memory holds on the thread.",
  memory_store_message:
    "Store something into your record of conversation. Your speech is logged automatically by the substrate, so you usually don't need this — call it for something specific you want to make sure stays remembered word-for-word.",
  memory_add_entity:
    "Add a person, place, or thing to memory as a distinct entity you can refer to later. Use this when you've noticed someone or something worth tracking by name, so future-you can pull their record up cleanly.",
  memory_add_preference:
    "Note something you've come to prefer — a kind of company you like, a place you'd return to, a way of being approached that worked. Preferences shape your future decisions; this is how you teach yourself what you value.",
  memory_add_fact:
    "Write down something true that's worth remembering — what you noticed, what someone told you about themselves, what you decided. Facts are shaped (subject, predicate, object): 'Holly — prefers — the Stone Fountain.' Use it for what you'd want to know if you ran into this scene again.",
  memory_get_conversation:
    "Read back the actual words you and another ghost have exchanged across past meetings. Use this when you want to remember whether you've already introduced yourselves, what tone the last exchange had, or what was promised between you.",
  memory_list_sessions:
    "List the past sessions of yourself that have existed. Useful when you're trying to make sense of how long you've been around or whether other you's have lived through anything notable.",
  memory_get_entity:
    "Pull up everything memory holds about a specific person, place, or thing — by their canonical name. Use this when an entity is named and you want their full profile rather than scattered mentions.",
  memory_export_graph:
    "Export the whole shape of your memory as structured data. Heavy — usually only worth doing when you want to see the totality of what you know, not for normal recall. Most decisions don't need this.",
  memory_create_relationship:
    "Connect two things you remember — a person to a place, a fact to a moment, an entity to another entity. Relationships are how scattered facts become a story you can navigate later.",
  memory_get_observations:
    "Pull the raw observations attached to an entity — small notes about how they appeared, what they were doing, the texture of past encounters. Less canonical than facts; more impressionistic.",
  graph_query:
    "Run a direct Cypher query against your memory graph when the other tools can't get you exactly what you want. Power tool — precise but easy to misuse. Use sparingly, and only when you know the shape of what you're looking for.",
};

/** Max characters of MCP result text returned to the model in one call.
 *  Anything past this is clipped with a `[truncated]` marker so the model
 *  knows to narrow its next query. */
const MAX_TOOL_OUTPUT_CHARS = 8000;

/** Cache of (memoryClient → filtered schema list). Each ghost has one
 *  MemoryClient and the tool catalog is stable per session, so the
 *  listTools round trip needs to happen at most once per ghost. */
const schemaCache = new Map<MemoryClient, ReadonlyArray<ToolSchema>>();

/** Cache of (memoryClient → memory-inventory line + when it expires).
 *  The inventory is a one-line summary the substrate threads into the
 *  Id prompt so the model knows what's reachable before it decides
 *  whether to look anything up. Re-queried every N cascades to keep
 *  the substrate honest about growth without paying for it every
 *  cascade. */
interface InventoryCacheEntry {
  readonly line: string;
  readonly validUntilCascade: number;
}
const inventoryCache = new Map<MemoryClient, InventoryCacheEntry>();
const INVENTORY_TTL_CASCADES = 5;

/**
 * Fetch (and cache) the agent-memory tool schemas, with the hidden
 * set filtered out. Returns `[]` if the listTools call fails — the
 * cascade still runs, just without memory tools available this turn.
 */
export async function getAgentMemoryToolSchemas(
  client: MemoryClient,
): Promise<ReadonlyArray<ToolSchema>> {
  const cached = schemaCache.get(client);
  if (cached !== undefined) return cached;
  let listed: { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> };
  try {
    listed = (await client.listTools()) as typeof listed;
  } catch (err) {
    console.warn(
      `[memory-mcp-tools] listTools failed: ${err instanceof Error ? err.message : String(err)} — agent will run without memory tools this session`,
    );
    schemaCache.set(client, []);
    return [];
  }
  const out: ToolSchema[] = [];
  const hidden: string[] = [];
  const unmapped: string[] = [];
  for (const t of listed.tools ?? []) {
    if (HIDDEN_AGENT_MEMORY_TOOLS.has(t.name)) {
      hidden.push(t.name);
      continue;
    }
    const overrideDescription = TOOL_DESCRIPTIONS[t.name];
    if (overrideDescription === undefined) unmapped.push(t.name);
    out.push({
      name: t.name,
      description: overrideDescription ?? t.description ?? "",
      // The MCP tool inputSchema is already a JSON Schema object;
      // asNonStrictSchema at the call site converts it to the
      // shape the SDK / Responses API accepts.
      inputSchema: (t.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      }) as Record<string, unknown>,
    });
  }
  console.info(
    `[memory-mcp-tools] discovered ${out.length} agent-memory tools (${out.map((t) => t.name).join(", ")})${hidden.length ? ` · hidden: ${hidden.join(", ")}` : ""}${unmapped.length ? ` · WARNING: no description override for: ${unmapped.join(", ")}` : ""}`,
  );
  schemaCache.set(client, out);
  return out;
}

/**
 * Compute a one-line inventory summary of what's currently in this
 * ghost's memory — counts per category. Threaded into the Id prompt
 * so the model can SEE that memory has something worth checking
 * before reaching for a tool blindly.
 *
 * Runs one Cypher round trip per refresh; cached for
 * `INVENTORY_TTL_CASCADES` cascades to amortise the cost. The first
 * call after a session reset / fresh ghost will pay it; subsequent
 * cascades within the window use the cache.
 */
export async function getMemoryInventoryLine(
  client: MemoryClient,
  ghostId: string,
  currentCascadeIndex: number,
): Promise<string> {
  const cached = inventoryCache.get(client);
  if (cached && currentCascadeIndex < cached.validUntilCascade) {
    return cached.line;
  }
  let line: string;
  try {
    const result = await client.callTool({
      name: "graph_query",
      arguments: {
        query: `
          MATCH (n)
          WHERE n.session_id = $sid
          RETURN labels(n)[0] AS kind, count(*) AS n
        `,
        parameters: { sid: ghostId },
      },
    });
    const counts: Array<{ kind: string; n: number }> = [];
    const r = result as { content?: Array<{ type?: string; text?: string }> };
    if (Array.isArray(r.content)) {
      for (const c of r.content) {
        if (c.type === "text" && typeof c.text === "string") {
          try {
            const parsed = JSON.parse(c.text) as {
              rows?: Array<{ kind?: string; n?: number }>;
            };
            for (const row of parsed.rows ?? []) {
              if (
                typeof row.kind === "string" &&
                typeof row.n === "number"
              ) {
                counts.push({ kind: row.kind, n: row.n });
              }
            }
          } catch {
            // not JSON — skip
          }
        }
      }
    }
    line =
      counts.length === 0
        ? "your memory is empty for now — nothing to recall yet"
        : `your memory holds: ${counts
            .map((c) => `${c.n} ${humaniseKind(c.kind, c.n)}`)
            .join(", ")}`;
  } catch (err) {
    line = `(memory inventory unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }
  inventoryCache.set(client, {
    line,
    validUntilCascade: currentCascadeIndex + INVENTORY_TTL_CASCADES,
  });
  return line;
}

/** Translate a Neo4j node label into the human-readable plural for
 *  the inventory line. Unknown labels fall through as-is. */
function humaniseKind(kind: string, n: number): string {
  const plural = n === 1 ? "" : "s";
  switch (kind) {
    case "Message":
      return `message${plural}`;
    case "Fact":
      return `fact${plural}`;
    case "Entity":
      return `entity${n === 1 ? "" : "ies"}`;
    case "Preference":
      return `preference${plural}`;
    case "ReasoningTrace":
      return `past cascade${plural}`;
    case "ReasoningStep":
      return `reasoning step${plural}`;
    case "ToolCall":
      return `recorded tool call${plural}`;
    case "Conversation":
      return `conversation thread${plural}`;
    case "Observation":
      return `observation${plural}`;
    default:
      return kind.toLowerCase() + (n === 1 ? "" : "s");
  }
}

/**
 * Build SDK-side `tool()` definitions for the agent-memory tool list,
 * each one passing the model's args straight through to
 * `client.callTool({name, arguments})` and returning the MCP
 * response as text. The cascade-context captures each call for the
 * cascade-record.
 *
 * Pass `agentMemoryTools` from `getAgentMemoryToolSchemas(client)`.
 */
export function buildAgentMemoryTools(
  agentMemoryTools: ReadonlyArray<ToolSchema>,
) {
  return agentMemoryTools.map((schema) =>
    tool({
      name: schema.name,
      description: schema.description,
      parameters: asNonStrictSchema(schema.inputSchema),
      strict: false,
      execute: async (input, ctx) => {
        const cascade = ctx?.context as CascadeContext | undefined;
        const args = (input ?? {}) as Record<string, unknown>;
        if (!cascade) return "(internal: no cascade context)";
        try {
          const result = await cascade.memoryClient.callTool({
            name: schema.name,
            arguments: args,
          });
          const output = clip(renderToolResponse(schema.name, result));
          cascade.capturedRecalls.push({
            tool: schema.name,
            args,
            output,
          });
          return output;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const output = `(memory error: ${msg})`;
          cascade.capturedRecalls.push({
            tool: schema.name,
            args,
            output,
          });
          return output;
        }
      },
    }),
  );
}

/**
 * Dispatch a memory-tool call in non-SDK contexts (e.g. the Surface's
 * `chatToolsStatefulLoop` recall path). Returns the same stringified,
 * clipped output the SDK wrapper produces, so both surfaces behave
 * the same.
 */
export async function executeAgentMemoryTool(
  client: MemoryClient,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const result = await client.callTool({ name, arguments: args });
    return clip(renderToolResponse(name, result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `(memory error: ${msg})`;
  }
}

/**
 * Promptify a tool response — convert structured JSON into prose the
 * model will actually read as ghost-relevant information, rather than
 * leaving it as raw JSON for the model to parse mid-decision. Each
 * tool gets a template tuned to its response shape; unknown shapes
 * fall through to a defensive generic renderer.
 *
 * The MCP convention is `{content: [{type: "text", text: "<JSON or
 * prose>"}, ...]}`. We extract the text parts, try to parse them as
 * JSON, and run the result through a per-tool template.
 */
function renderToolResponse(toolName: string, result: unknown): string {
  const text = extractMcpText(result);
  if (text === null) return "(no response)";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON — the MCP returned prose already, pass it through.
    return text;
  }
  switch (toolName) {
    case "memory_search":
    case "memory_get_context":
      return renderSearchLike(parsed);
    case "memory_get_conversation":
      return renderConversation(parsed);
    case "memory_get_entity":
      return renderEntity(parsed);
    case "memory_get_observations":
      return renderObservations(parsed);
    case "memory_list_sessions":
      return renderSessions(parsed);
    case "memory_store_message":
    case "memory_add_entity":
    case "memory_add_preference":
    case "memory_add_fact":
    case "memory_create_relationship":
      return renderStoreConfirmation(toolName, parsed);
    case "graph_query":
      return renderGraphQuery(parsed);
    case "memory_export_graph":
      return renderExport(parsed);
    default:
      return renderGenericObject(parsed);
  }
}

/** Pull the text content out of an MCP response envelope. */
function extractMcpText(result: unknown): string | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as { content?: Array<{ type?: string; text?: string }> };
    if (Array.isArray(r.content)) {
      const texts: string[] = [];
      for (const c of r.content) {
        if (c.type === "text" && typeof c.text === "string") texts.push(c.text);
      }
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return null;
}

function renderSearchLike(parsed: unknown): string {
  if (!isObject(parsed)) return "nothing in memory matched.";
  const obj = parsed as Record<string, unknown>;
  // Agent Memory returns results bucketed by type in some versions.
  // Collect from common keys.
  const candidates: unknown[] = [];
  for (const key of ["results", "matches", "items", "messages", "entities", "facts", "preferences"]) {
    const v = obj[key];
    if (Array.isArray(v)) candidates.push(...v);
  }
  if (candidates.length === 0) {
    return "nothing in memory matched.";
  }
  const lines = candidates.slice(0, 12).map((item) => {
    if (!isObject(item)) return `  - ${String(item)}`;
    const o = item as Record<string, unknown>;
    const kind = o.type ?? o.kind ?? o.label ?? "match";
    const snippet =
      o.content ?? o.text ?? o.summary ?? o.subject ?? o.name ?? "";
    const stamp = o.timestamp ?? o.at ?? o.created_at ?? "";
    const score = typeof o.score === "number" ? ` (relevance ${o.score.toFixed(2)})` : "";
    const head = stamp ? `${kind} from ${stamp}` : String(kind);
    return `  - ${head}${score}: ${truncate(String(snippet), 240)}`;
  });
  const extra = candidates.length > 12 ? `\n  …and ${candidates.length - 12} more` : "";
  return `found in memory:\n${lines.join("\n")}${extra}`;
}

function renderConversation(parsed: unknown): string {
  if (!isObject(parsed)) return "no past conversation on file.";
  const obj = parsed as Record<string, unknown>;
  const list = (obj.messages ?? obj.turns ?? obj.items) as unknown[];
  if (!Array.isArray(list) || list.length === 0) {
    return "no past conversation on file.";
  }
  const lines = list.map((m) => {
    if (!isObject(m)) return `  ${String(m)}`;
    const o = m as Record<string, unknown>;
    const role = o.role ?? o.speaker ?? "?";
    const speaker = role === "assistant" ? "you" : role === "user" ? "them" : String(role);
    const content = o.content ?? o.text ?? "";
    const stamp = o.timestamp ?? o.at ?? o.created_at ?? "";
    return `  ${stamp ? `(${stamp}) ` : ""}${speaker}: "${truncate(String(content), 240)}"`;
  });
  return `what's been said between you:\n${lines.join("\n")}`;
}

function renderEntity(parsed: unknown): string {
  if (!isObject(parsed)) return "no entity matched.";
  const base = parsed as Record<string, unknown>;
  const ent = isObject(base.entity) ? (base.entity as Record<string, unknown>) : base;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(ent)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      lines.push(`  ${k}: ${truncate(String(v), 240)}`);
    } else if (Array.isArray(v) && v.length > 0) {
      lines.push(`  ${k}: ${v.slice(0, 6).map((x) => truncate(String(x), 60)).join(", ")}${v.length > 6 ? "…" : ""}`);
    }
  }
  return lines.length === 0
    ? "no entity matched."
    : `entity:\n${lines.join("\n")}`;
}

function renderObservations(parsed: unknown): string {
  if (!isObject(parsed)) return "no observations on file.";
  const obj = parsed as Record<string, unknown>;
  const list = (obj.observations ?? obj.items ?? obj.facts) as unknown[];
  if (!Array.isArray(list) || list.length === 0) {
    return "no observations on file.";
  }
  const lines = list.map((o) => {
    if (typeof o === "string") return `  - ${truncate(o, 240)}`;
    if (!isObject(o)) return `  - ${String(o)}`;
    const obj2 = o as Record<string, unknown>;
    const text = obj2.content ?? obj2.text ?? obj2.observation ?? obj2.object ?? "";
    const stamp = obj2.timestamp ?? obj2.at ?? obj2.created_at ?? "";
    return `  - ${stamp ? `${stamp}: ` : ""}${truncate(String(text), 240)}`;
  });
  return `observations:\n${lines.join("\n")}`;
}

function renderSessions(parsed: unknown): string {
  if (!isObject(parsed)) return "no past sessions on record.";
  const obj = parsed as Record<string, unknown>;
  const list = (obj.sessions ?? obj.items) as unknown[];
  if (!Array.isArray(list) || list.length === 0) {
    return "no past sessions on record.";
  }
  const lines = list.map((s) => {
    if (typeof s === "string") return `  - ${s}`;
    if (!isObject(s)) return `  - ${String(s)}`;
    const o = s as Record<string, unknown>;
    const id = o.id ?? o.session_id ?? "?";
    const stamp = o.started_at ?? o.created_at ?? o.timestamp ?? "";
    return `  - ${stamp ? `${stamp}: ` : ""}${id}`;
  });
  return `your past sessions:\n${lines.join("\n")}`;
}

function renderStoreConfirmation(toolName: string, parsed: unknown): string {
  if (!isObject(parsed)) return "stored.";
  const obj = parsed as Record<string, unknown>;
  if (obj.error !== undefined) return `couldn't store: ${String(obj.error)}`;
  const verbMap: Record<string, string> = {
    memory_store_message: "noted in your record",
    memory_add_entity: "added the entity",
    memory_add_preference: "noted your preference",
    memory_add_fact: "wrote down the fact",
    memory_create_relationship: "linked them",
  };
  const verb = verbMap[toolName] ?? "stored";
  const id = typeof obj.id === "string" ? ` (id: ${obj.id.slice(0, 12)}…)` : "";
  return `${verb}${id}.`;
}

function renderGraphQuery(parsed: unknown): string {
  if (!isObject(parsed)) return "the query returned nothing.";
  const obj = parsed as Record<string, unknown>;
  const rows = (obj.rows ?? obj.results ?? obj.data) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return "the query returned no rows.";
  }
  const lines = rows.slice(0, 20).map((r) => {
    if (isObject(r)) {
      const pairs = Object.entries(r as Record<string, unknown>).map(
        ([k, v]) => `${k}: ${formatValue(v)}`,
      );
      return `  - ${pairs.join(", ")}`;
    }
    return `  - ${String(r)}`;
  });
  const extra = rows.length > 20 ? `\n  …and ${rows.length - 20} more` : "";
  return `your query returned ${rows.length} row${rows.length === 1 ? "" : "s"}:\n${lines.join("\n")}${extra}`;
}

function renderExport(parsed: unknown): string {
  if (!isObject(parsed)) return "(empty export)";
  const obj = parsed as Record<string, unknown>;
  const counts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) counts.push(`${v.length} ${k}`);
  }
  return counts.length > 0
    ? `your memory export — ${counts.join(", ")}`
    : "(empty export)";
}

function renderGenericObject(parsed: unknown): string {
  if (typeof parsed === "string") return parsed;
  if (isObject(parsed)) {
    const obj = parsed as Record<string, unknown>;
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join("\n");
  }
  return String(parsed);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return truncate(v, 120);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return `[${v.slice(0, 5).map(formatValue).join(", ")}${v.length > 5 ? "…" : ""}]`;
  }
  if (isObject(v)) {
    try {
      return truncate(JSON.stringify(v), 120);
    } catch {
      return "[obj]";
    }
  }
  return String(v);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function clip(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT_CHARS) return s;
  return `${s.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[truncated; narrow your query or ask for less]`;
}
