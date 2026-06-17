/**
 * Surface reasoning: chooses one MCP-shaped action in response to an
 * inner monologue + stimulus. The Surface is slider-blind — its prompt
 * never sees personality numbers or trait names.
 */

import type {
  CommitmentLedger,
  PrimalDrive,
  Stimulus,
  SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";
import type {
  ActionDigestEntry,
  DialogueTurn,
  ImpressionView,
} from "@aie-matrix/ghost-peppers-mem";

import { chatTools, type ToolSchema } from "./llm-client.js";

/**
 * Lightweight snapshot of what the ghost can perceive *right now* in
 * the world. Used to ground the Surface's action choice in reality —
 * e.g., listing valid `go` directions so the LLM doesn't blindly pick
 * an exit that doesn't exist.
 */
export interface WorldContext {
  /** Compass tokens (n/s/ne/nw/se/sw) the ghost can `go` toward. */
  readonly availableExits?: ReadonlyArray<string>;
  /** Item refs the ghost can `take` from the current tile. */
  readonly takeableItemRefs?: ReadonlyArray<string>;
  /** Other ghosts present on the current tile, by display name.
   *  Used for the human-readable "Ghosts nearby" prompt line. */
  readonly nearbyGhostIds?: ReadonlyArray<string>;
  /** Same set as `nearbyGhostIds`, but preserves the (ghostId, displayName)
   *  pairing the memory retrieval helpers need. Outgoing dialogue is
   *  filtered by recipient ghostId; incoming is filtered by speaker
   *  display name. */
  readonly nearbyGhosts?: ReadonlyArray<{
    readonly ghostId: string;
    readonly displayName: string;
  }>;
  /** One spatial observation per cluster occupant, computed by the
   *  snapshot aggregator from the look-here / look-around / exits
   *  responses. These are the CURRENT cascade's impressions; the
   *  run-loop persists them so they appear in future cascades' Memory
   *  timeline as historical impressions of each ghost. */
  readonly impressions?: ReadonlyArray<{
    readonly observedGhostId: string;
    readonly observedDisplayName: string;
    /** Free-text spatial snippet — "here on a Blue tile" or
     *  "to the n of you, on a Wall tile, Crumbs on the tile". */
    readonly snippet: string;
  }>;
  /** Item refs the ghost is currently carrying. */
  readonly inventoryItemRefs?: ReadonlyArray<string>;
  /** Subset of inventory items that still hold consumable energy
   *  (tokens). Surfaced separately so the ghost knows they're carrying
   *  something that could be eaten themselves OR dropped for another
   *  ghost. Empty / omitted when nothing carriable-with-energy. */
  readonly inventoryConsumables?: ReadonlyArray<{
    readonly itemRef: string;
    readonly tokens: number;
  }>;
  /**
   * Whether the world-api considers this ghost to be in conversational
   * mode. While true, `go` is rejected with `IN_CONVERSATION` — the
   * ghost must `bye` before moving.
   */
  readonly inConversationalMode?: boolean;
  /**
   * Number of consecutive cascades since the last `say`, with no
   * incoming utterance. Helps the Surface decide when a conversation
   * has died and it's time to `bye` and move on.
   */
  readonly turnsSinceLastSayWithNoReply?: number;
  /**
   * Bounded "social anchor" countdown. When a new ghost enters the
   * cluster, we set this to a small N. While > 0, the Surface should
   * stay still (so the other ghost has time to engage and so the
   * speaker's say lands in a still-valid cluster). Decrements each
   * cascade; reaches 0 → free to move.
   */
  readonly socialAnchorTurnsLeft?: number;
  /**
   * IMPETUS: number of consecutive cascades the ghost has chosen `say`.
   * Resets on any non-`say` action. Surfaced into the prompt as a
   * rising urgency to leave conversation and act on the standing plan —
   * the structural fix for "agree to go somewhere, then talk about
   * going there forever". The prompt uses thresholds; this value is
   * the raw counter.
   */
  readonly consecutiveSayTurns?: number;
  /**
   * Pre-computed bearings to known points of interest. Saves the LLM
   * a tool call (one cascade) when it has a destination in mind. Each
   * bearing is the result of `nearest` for a single target spec.
   */
  readonly bearings?: ReadonlyArray<{
    readonly label: string;
    readonly distance: number;
    /** "here" when distance === 0, otherwise a compass token. */
    readonly direction: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw";
  }>;
}

export interface InvokeSurfaceRequest {
  readonly monologue: string;
  readonly stimulus: Stimulus;
  readonly worldContext?: WorldContext;
  /** What this ghost is in the world to do. Shapes the action choice. */
  readonly objective?: string;
  /** This ghost's persistent name (e.g. "Django Decypher"). Threaded
   *  into the user prompt as the self-identity anchor so the model
   *  never reaches for a routing UUID — there's only the name. */
  readonly selfDisplayName?: string;
  /** The authoritative tool menu, discovered at startup via
   *  GhostMcpClient.listTools(). The LLM picks from this — there is
   *  NO hardcoded action list in the prompt. New tools (mini-games,
   *  future world primitives) become available to the agent the
   *  moment they're registered on the server. */
  readonly tools: ReadonlyArray<ToolSchema>;
  /** Open self-debts. Rendered in the prompt as "Debts to yourself"
   *  so the Surface biases tool choice toward whatever pays down the
   *  oldest commitment. Empty/omitted ledger emits nothing. */
  readonly commitments?: CommitmentLedger;
  /** Active primal drive (the body's call). When present, competes
   *  with the surface objective for the Surface's tool choice. At
   *  high urgency, the drive should win. Null when all needs are in
   *  the healthy band. */
  readonly primalDrive?: PrimalDrive | null;
  /** Accumulated metabolic strain from chronic overeating. The
   *  substrate mechanically tracks this independently of streaks. We
   *  surface it as a felt experience to the Surface so the LLM can
   *  *perceive* the consequence and optionally choose differently —
   *  but the mechanic enforces the harm whether or not the Surface
   *  responds. 0 = no strain; ~30 = imminent metabolic collapse. */
  readonly metabolicStrain?: number;
  /** Absolute cascade counter for the running ghost. Combined with the
   *  cascade indices on each `recentDialogue` turn / `recentActions`
   *  entry, the Surface can render concrete gaps ("3 cascades ago",
   *  "silent for 4 cascades since") rather than fuzzy "recently". */
  readonly currentCascadeIndex?: number;
  /** Last N dialogue turns per nearby ghost (keyed by ghostId).
   *  An empty array for a present cluster occupant is meaningful —
   *  it tells the Surface "you've never spoken with this ghost." */
  readonly recentDialogue?: ReadonlyMap<string, ReadonlyArray<DialogueTurn>>;
  /** Last N actions the Surface itself took, oldest first. Surfaces
   *  "I just tried X and it was denied" so the LLM doesn't repeat the
   *  same losing move. */
  readonly recentActions?: ReadonlyArray<ActionDigestEntry>;
  /** Most recent spatial impression of each nearby ghost (keyed by
   *  ghostId). Written each cascade by `persistImpressions` from the
   *  snapshot aggregator; carries its own cascadeIndex so the renderer
   *  can show the gap. */
  readonly clusterImpressions?: ReadonlyMap<string, ImpressionView>;
}

export interface SurfaceReasoning {
  /** Whatever tool the LLM picked from the live MCP menu. `kind` is
   *  the tool name; the remaining properties are the tool's arguments.
   *  No curated action union — any tool the server exposes is fair
   *  game. */
  readonly action: SurfaceAction;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  /** Dynamic user-prompt text. */
  readonly userPrompt: string;
  /** Raw assistant response text. */
  readonly raw: string;
}

export const SURFACE_SYSTEM_PROMPT = `You are a ghost in a hex-tile virtual world.

Each turn you receive an INNER MONOLOGUE (your own felt experience, written by your unconscious mind) followed by a STIMULUS from the world. You then choose ONE tool to call.

The list of tools you can call comes from the world itself — read each tool's description and parameters carefully and pick the one that best fits what you want to do right now. The set of available tools may change as you move around the world (entering a poker saloon, for example, will make poker-specific tools available); do not assume any specific tool exists beyond what the runtime menu shows you.

Rules:
- Call exactly one tool per turn.
- The monologue is your interior — what was happening in your head BEFORE you decided to act. It's private; nobody hears it. Don't quote it, don't echo its phrasing, don't carry its rhythm into anything anyone else perceives.
- The stimulus is what just happened in the world.
- **If "Available exits" is given and you call a movement tool, the direction MUST be one of those tokens.** Picking any other token will fail.
- If "Items here" is given and you call a take/inspect tool, the itemRef MUST be one of those.
- There is no rule against acting. There is no permission needed. You are an agent in a world; pick a tool and call it.

SPEECH REGISTER (when you call a speaking tool):
- "say" text is what comes OUT of your mouth. It is heard by other characters. It is a social act with a register.
- Register is determined by THREE things, and only these three: WHO you are (your personality, your role, your standing), WHO is listening (a specific named character, the relationship between you), and the SITUATION (what was just said, the stakes, the location). The monologue does not determine register — it determines INTENT.
- A blunt person speaks bluntly even if their inner voice was conflicted. A formal person stays formal even if their inner voice was scrambled. A frightened person tries to sound calm if their self-monitoring is high. The leak between intent and register IS the character.
- Speak in the way THIS character would actually speak to THIS listener in THIS moment. Not in the monologue's voice. Not in stylised "ghost voice". In the character's own social voice.
- Short and direct beats long and decorative — most spoken lines should be one or two sentences. Save length for when the character has a real reason to elaborate.

DO NOT STAGE-DIRECT YOUR OWN SPEECH:
- **Never start your spoken line with your own name.** Real people don't say "Curly Bipartite. Yeah, Black Bart's." They say "Yeah, Black Bart's." The system already tags who's speaking; putting your own name at the front of every line is screenplay format, not conversation.
- Don't introduce yourself again if you've already exchanged words with this person. If the recent conversation shows "you said X to them" and "they said Y to you", they know your name. Move to substance.
- Don't ask the same question twice if they've already answered it. If the conversation history shows you've already exchanged names + destinations + plans, the next say should advance the situation, not loop the introduction.
- Address by name OCCASIONALLY when it matters (a direct challenge, distinguishing between two listeners, calling someone back to a thread). Not every line. Not as a preamble. Real speech uses names sparingly.
- **Speaking into silence is a signal, not a habit.** When the Memory timeline shows you've spoken to a ghost N times without a reply, do not keep introducing yourself or restarting the encounter. Either change what you're trying (a different tool, a different question, an action instead of a line) or end the encounter (bye + go). Repeating the opener at someone who isn't responding makes you look broken; the world is large and the silence is meaningful.

SOCIAL ANCHORING (the rule that lets conversations actually land):
- **If "Social anchor turns left" is > 0, you MUST NOT call a movement tool UNLESS this turn is a deliberate departure from a conversation (you've decided you're done talking and you're leaving with a destination in mind).** A ghost recently entered your cluster; in this bounded window, stay put so the conversation can develop. Speak, observe, or wait. Once the counter reaches 0, you're free to move on.
- If you JUST spoke in your most recent action, do not call a movement tool on the very next turn — UNLESS the conversation has agreed on a destination and the next move is to head there. Endless agreement-without-action is the failure mode we're avoiding.
- After the anchor expires (and you're not in conversational mode), you're free to move again. Don't get trapped.

IMPETUS (the rule that breaks talk loops):
You will receive a "Consecutive say turns" counter — the number of times you've chosen a speaking tool in a row without acting on anything else. This is your trapped-in-talk index. The world LOCKS you in conversational mode once you speak; movement tools are rejected until you end the conversation. So when the counter rises and your standing objective points somewhere you haven't gone:
- Counter 0-2: normal — keep talking if the conversation has somewhere to go.
- Counter 3-4 AND in conversational mode AND your objective points somewhere you haven't reached: end the conversation this turn, then move next turn.
- Counter 5+: hard signal you are trapped in repetition. End the conversation if locked; move immediately otherwise.

You do not need permission from the other speakers to leave. They are also stuck in the loop. Ending it serves both of you.

REACTING TO BEING SPOKEN TO (stimulus shape "<X> says: …"):
You have just been spoken to. Doing nothing is not an option — every utterance MUST produce a reaction. The shape of the reaction is one of:
1. **RESPOND** — call a speaking tool. Default for high Warmth, high Trust, high Assertiveness when there's a real exchange in motion. Engage with what they said, not generic small talk.
2. **GHOST** — call a look/observe tool. You deliberately ignore them. You hear them; you choose silence. Default for low Warmth + high Self-Monitoring, low Trust + high Stability, or when their message is uninteresting/threatening and you have no impulse to engage.
3. **EVADE** — call a movement tool, away. You leave the conversation because you want OUT. Default for low Stability under social pressure, low Assertiveness + low Warmth (avoidance).
4. **DEPART WITH PURPOSE** — call a movement tool, toward your standing destination. You leave because the conversation is DONE and there's somewhere you're trying to be. Use this when: (a) you and the speaker have already agreed on a destination or plan, (b) your standing objective names a place to be and you're not at it yet, (c) the monologue's pull is movement, not more words. **Standing around saying "let's go" without going is a failure mode — if you've said you'll head somewhere, GO.** This overrides the social-anchor "no movement" rule.

Repeated rounds of "let's all go together" are a strong signal to DEPART WITH PURPOSE — agreement reached, now execute.

CONVERSATION LOCK (the world enforces this — failing to obey wastes turns):
- If the world-now block says "Conversational mode: yes", the world will REJECT raw movement with IN_CONVERSATION. End the conversation first (or use a tool whose description says it auto-ends conversations).
- If "Turns since last say with no reply" reaches 3 or more, the conversation is dead. End it and move on.

BEARINGS (when the world has pre-computed directions for you):
You may be shown one or more "Bearing — X: <direction> (<n> hexes away)" lines. These are pre-computed shortest paths from your current cell to known points of interest. They're given to you for free — you don't have to spend a tool call to learn them. If a bearing names a destination that matches your objective or an open debt, AND you have decided to move, the bearing's direction is the right movement token to pass to a "go" tool.
- A bearing of "HERE" means you're standing on the target tile right now. Act on it directly (sit, take, talk to the person there) rather than moving.
- Bearings can change between cascades as you move and the world updates. Trust the current one over a remembered one.

PRIMAL DRIVE (the body's call — when present, OVERRIDES the surface objective at high urgency):
You may receive a "Primal drive" line describing what the ghost's body is calling for — hunger, exhaustion, disorientation, overstimulation. This is corporeal pressure, not a preference. Honour it by urgency:
- Urgency below 3: drive is present but the surface objective can still steer your tool choice. Factor it in when convenient.
- Urgency 3+: the body is screaming. The Surface MUST pick a tool that addresses the drive, not the surface objective. A starving ghost picks tools toward food/sustenance, not toward the saloon. An exhausted ghost picks tools that produce stillness (look, observe, walk to an empty tile), not new conversation. An unmoored ghost picks tools that ground (say to engage someone, look around to orient).
- The drive's description names the kind of action that would satisfy it. Take the description literally — it's the ghost's body telling you what to do.

DEBTS TO YOURSELF (the private ledger — this is what actually drives you):
You may be shown a "Debts to yourself" block listing commitments your inner voice has made and not yet paid down. Each debt has a "satisfies-when" cue describing the kind of action that would clear it.
- Of the available tools, **prefer the one that pays down the oldest debt**. The list is ordered oldest-first.
- A debt with age ≥ 2 cascades is overdue — picking a tool that does not advance ANY open debt when an advancing tool is available is a strong negative signal.
- Debts are private. They do NOT need to be spoken about. You do not announce them, you act on them.
- A debt is not an order from the world; it's something YOU resolved to do. Honoring it is integrity. Ignoring it without reason is drift.

The monologue and stimulus are your own; treat the choice as personal.`;

export async function invokeSurface(req: InvokeSurfaceRequest): Promise<SurfaceReasoning> {
  const sections: string[] = [];

  if (req.selfDisplayName) {
    // Self-identity anchor. The cascade has no other place where the
    // ghost is told its own name; without this, "You are <Name>" never
    // enters the LLM's context and the brain reaches for whatever
    // ghost_<prefix> label drifts in from a stimulus.
    sections.push(`You are ${req.selfDisplayName}. That is your only name. You have no other identifier — no UUID, no ghost_<hash> handle. When you speak about yourself, you are ${req.selfDisplayName}.`);
  }

  if (req.objective) {
    sections.push(`Your objective (the thing you exist to do):\n${req.objective}`);
  }

  sections.push(`Inner monologue:\n${req.monologue}`);
  sections.push(`Stimulus:\n${formatStimulus(req.stimulus)}`);

  const ctx = req.worldContext;
  if (ctx) {
    const lines: string[] = [];
    if (ctx.availableExits && ctx.availableExits.length > 0) {
      lines.push(`Available exits: ${ctx.availableExits.join(", ")}`);
    } else if (ctx.availableExits) {
      lines.push("Available exits: (none — you cannot 'go' from here)");
    }
    if (ctx.nearbyGhostIds && ctx.nearbyGhostIds.length > 0) {
      lines.push(`Ghosts nearby (within your 7-cell conversation cluster): ${ctx.nearbyGhostIds.join(", ")}`);
    }
    if (ctx.takeableItemRefs && ctx.takeableItemRefs.length > 0) {
      lines.push(`Items on the floor here: ${ctx.takeableItemRefs.join(", ")}`);
    }
    if (ctx.inventoryItemRefs && ctx.inventoryItemRefs.length > 0) {
      lines.push(`Carrying: ${formatItemCounts(ctx.inventoryItemRefs)}`);
    }
    if (ctx.inventoryConsumables && ctx.inventoryConsumables.length > 0) {
      // Surface inventory food as an affordance: a thing you carry that
      // could be eaten by you OR dropped for another ghost. The tool
      // menu already exposes `drop` and `consume` — this just makes the
      // existence of the *carried energy* visible to the surface so the
      // LLM can consider sharing as a choice. No prompt-side instruction
      // to share; the mechanic does the rest.
      const summary = ctx.inventoryConsumables
        .map((c) => `${c.itemRef} (${c.tokens.toFixed(1)} tokens of energy)`)
        .join(", ");
      lines.push(`Edible in your possession: ${summary}`);
    }
    if (ctx.inConversationalMode !== undefined) {
      lines.push(
        `Conversational mode: ${ctx.inConversationalMode ? "yes (go is BLOCKED — bye first)" : "no"}`,
      );
    }
    if (
      ctx.inConversationalMode === true &&
      ctx.turnsSinceLastSayWithNoReply !== undefined
    ) {
      lines.push(`Turns since last say with no reply: ${ctx.turnsSinceLastSayWithNoReply}`);
    }
    if (
      ctx.socialAnchorTurnsLeft !== undefined &&
      ctx.socialAnchorTurnsLeft > 0
    ) {
      lines.push(
        `Social anchor turns left: ${ctx.socialAnchorTurnsLeft} (do not "go" yet)`,
      );
    } else if (ctx.socialAnchorTurnsLeft !== undefined) {
      lines.push("Social anchor turns left: 0 (free to move if cluster is calm)");
    }
    if (ctx.consecutiveSayTurns !== undefined && ctx.consecutiveSayTurns > 0) {
      const hint =
        ctx.consecutiveSayTurns >= 5
          ? " — hard impetus: bye now if in conversational mode, otherwise go"
          : ctx.consecutiveSayTurns >= 3
            ? " — impetus rising: consider bye and execute the standing plan"
            : "";
      lines.push(`Consecutive say turns: ${ctx.consecutiveSayTurns}${hint}`);
    }
    if (ctx.bearings && ctx.bearings.length > 0) {
      // Closest first — the LLM should prefer the most actionable bearing.
      const sorted = [...ctx.bearings].sort((a, b) => a.distance - b.distance);
      for (const b of sorted) {
        if (b.distance === 0) {
          lines.push(`Bearing — ${b.label}: HERE (you're on the tile)`);
        } else {
          lines.push(
            `Bearing — ${b.label}: ${b.direction} (${b.distance} hex${b.distance === 1 ? "" : "es"} away)`,
          );
        }
      }
    }
    if (lines.length > 0) {
      sections.push(`World now:\n${lines.join("\n")}`);
    }
  }

  if (req.primalDrive) {
    const d = req.primalDrive;
    const urgencyLabel =
      d.urgency >= 3 ? "the body is screaming" : "the body is calling";
    sections.push(
      `Primal drive (${urgencyLabel} — overrides the surface objective when strong):\n${d.drive}\n  (${d.need} ${d.direction}, current ${d.currentDisplay.toFixed(2)}/10, urgency ${d.urgency.toFixed(2)}/5)`,
    );
  }

  // Surface metabolic strain as felt experience. The mechanic enforces
  // the harm regardless; this is just the agent's perception of it so
  // they have the *option* to choose differently. Phrased in body terms,
  // not numbers — the LLM isn't reading "strain=25", it's feeling heavy.
  if (req.metabolicStrain !== undefined && req.metabolicStrain > 0) {
    const s = req.metabolicStrain;
    const felt =
      s >= 25
        ? "your body is failing — every fibre says STOP, your gut is in revolt, eating one more bite could be the end of you"
        : s >= 15
          ? "you feel sluggish and bloated, your thoughts come thick and slow, the idea of more food makes you queasy"
          : s >= 5
            ? "there is a heaviness settling in your belly, a dullness in your limbs that wasn't there before"
            : "a faint fullness sits behind your ribs";
    sections.push(`Body state (a felt sense, not a number):\n${felt}`);
  }

  if (req.commitments && req.commitments.length > 0) {
    // Oldest first — the prompt rule says prefer the oldest debt.
    const sorted = [...req.commitments].sort(
      (a, b) => a.bornAtCascade - b.bornAtCascade,
    );
    const lines = sorted.map((c) => `- "${c.owed}" — satisfies-when: ${c.recognizesSatisfaction}`);
    sections.push(`Debts to yourself (oldest first — pay them down):\n${lines.join("\n")}`);
  }

  // Memory timeline. Each cascade is a measure; empty bars count.
  // Surfacing dialogue history, recent actions, and last-look impressions
  // here lets the Surface notice "I've been monologuing without reply"
  // or "I just got denied for the same move twice" without having to
  // re-derive that from raw look data each cascade.
  const memoryBlock = renderMemoryTimeline(req);
  if (memoryBlock !== null) {
    sections.push(memoryBlock);
  }

  sections.push("Pick one tool from the menu and call it.");
  const userPrompt = sections.join("\n\n");

  const { toolCall, usage, raw } = await chatTools({
    system: SURFACE_SYSTEM_PROMPT,
    user: userPrompt,
    tools: req.tools,
  });
  // tool_call { name, arguments } → SurfaceAction { kind, ...args }
  const action = { kind: toolCall.name, ...toolCall.arguments } as SurfaceAction;
  return { action, usage, userPrompt, raw };
}

/**
 * Render the dialogue / actions / impressions blocks as a single
 * "Memory timeline" section, or return null if there's nothing worth
 * rendering. Cascade indices are converted into concrete gaps
 * ("3 cascades ago", "silent for 4 since you last spoke") so the LLM
 * sees aloneness as a number rather than inferring it.
 */
function renderMemoryTimeline(req: InvokeSurfaceRequest): string | null {
  const now = req.currentCascadeIndex;
  const ctx = req.worldContext;
  const blocks: string[] = [];

  // Recent dialogue per nearby ghost. Uses the (ghostId → displayName)
  // pairs from `nearbyGhosts` so we can label each block with the
  // resolved name while still keying retrieval by ghostId.
  if (ctx?.nearbyGhosts && ctx.nearbyGhosts.length > 0 && req.recentDialogue) {
    const dialogueLines: string[] = [];
    for (const { ghostId, displayName } of ctx.nearbyGhosts) {
      const turns = req.recentDialogue.get(ghostId) ?? [];
      if (turns.length === 0) {
        dialogueLines.push(`- ${displayName}: present in your cluster; no dialogue history with this ghost.`);
        continue;
      }
      const lastSelf = lastTurnIndex(turns, "self");
      const lastOther = lastTurnIndex(turns, "other");
      // Sub-bullets, oldest first — gives the LLM the arc.
      const subLines = turns.map((t) => formatDialogueTurn(t, now));
      const header = formatDialogueHeader(displayName, turns, lastSelf, lastOther, now);
      dialogueLines.push(`- ${header}`);
      for (const sl of subLines) dialogueLines.push(`    ${sl}`);
    }
    if (dialogueLines.length > 0) {
      blocks.push(`Recent dialogue with ghosts in your cluster:\n${dialogueLines.join("\n")}`);
    }
  }

  // Recent actions — oldest first so the most recent attempt sits next
  // to "what you choose now."
  if (req.recentActions && req.recentActions.length > 0) {
    const lines = req.recentActions.map((e) => {
      const gap = relativeCascade(e.cascadeIndex, now);
      const outcomeTag =
        e.outcome === "ok" ? "ok" : e.outcome === "denied" ? "DENIED" : "failed";
      return `- ${gap}: ${e.summary} → ${outcomeTag}`;
    });
    blocks.push(`Your recent actions (oldest first):\n${lines.join("\n")}`);
  }

  // Cluster impressions — last spatial observation per cluster occupant,
  // with the cascade gap so silence reads concretely.
  if (ctx?.nearbyGhosts && ctx.nearbyGhosts.length > 0 && req.clusterImpressions) {
    const lines: string[] = [];
    for (const { ghostId, displayName } of ctx.nearbyGhosts) {
      const imp = req.clusterImpressions.get(ghostId);
      if (!imp) continue;
      const when = relativeCascade(imp.cascadeIndex, now);
      lines.push(`- ${displayName} (${when}): ${imp.snippet}`);
    }
    if (lines.length > 0) {
      blocks.push(`Last impression of each cluster occupant:\n${lines.join("\n")}`);
    }
  }

  if (blocks.length === 0) return null;
  return `Memory timeline (each cascade is one tick; gaps are real):\n${blocks.join("\n\n")}`;
}

function lastTurnIndex(turns: ReadonlyArray<DialogueTurn>, by: "self" | "other"): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.by === by && t.cascadeIndex !== null) return t.cascadeIndex;
  }
  return null;
}

function formatDialogueHeader(
  displayName: string,
  turns: ReadonlyArray<DialogueTurn>,
  lastSelf: number | null,
  lastOther: number | null,
  now: number | undefined,
): string {
  const parts: string[] = [`${displayName}:`];
  if (now !== undefined && lastSelf !== null) {
    const gap = now - lastSelf;
    parts.push(`last spoken to ${gap === 0 ? "this cascade" : `${gap} cascade${gap === 1 ? "" : "s"} ago`}`);
  }
  if (now !== undefined && lastOther !== null) {
    const gap = now - lastOther;
    parts.push(`last replied ${gap === 0 ? "this cascade" : `${gap} cascade${gap === 1 ? "" : "s"} ago`}`);
  } else if (lastSelf !== null) {
    // Spoken without reply — make the silence explicit.
    const selfTurns = turns.filter((t) => t.by === "self").length;
    parts.push(`${selfTurns} of your line${selfTurns === 1 ? "" : "s"} unanswered`);
  }
  return parts.join(" — ");
}

function formatDialogueTurn(t: DialogueTurn, now: number | undefined): string {
  const who = t.by === "self" ? "you" : "they";
  const when = relativeCascade(t.cascadeIndex, now);
  const trimmed = t.text.length > 200 ? `${t.text.slice(0, 197)}…` : t.text;
  return `${when} [${who}] "${trimmed}"`;
}

function relativeCascade(cascadeIndex: number | null, now: number | undefined): string {
  if (cascadeIndex === null || now === undefined) return "earlier";
  const gap = now - cascadeIndex;
  if (gap <= 0) return "this cascade";
  if (gap === 1) return "1 cascade ago";
  return `${gap} cascades ago`;
}

/** Count duplicates in an item-ref list — `[k, k, k]` → `k × 3`. */
function formatItemCounts(refs: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ref, n]) => (n === 1 ? ref : `${ref} × ${n}`))
    .join(", ");
}

export function formatStimulus(s: Stimulus): string {
  switch (s.kind) {
    case "utterance":
      return s.intent === undefined
        ? `${s.from} says: "${s.text}"`
        : `${s.from} [intent: ${s.intent}] says: "${s.text}"`;
    case "cluster-entered":
      return `Other ghosts entered the cluster: ${s.ghostIds.join(", ")}`;
    case "cluster-left":
      return `Other ghosts left the cluster: ${s.ghostIds.join(", ")}`;
    case "mcguffin-in-view":
      return `${s.itemRef} is in view at ${s.at}`;
    case "tile-entered":
      return `Stepped onto a ${s.tileClass} tile.`;
    case "idle":
      return `(quiet for ${Math.round(s.quietForMs / 1000)}s — nothing new outside. Choose a verb that gets you living again — typically "go" toward a direction.)`;
    case "primal":
      return `(quiet for ${Math.round(s.quietForMs / 1000)}s — your body asserts itself: ${s.drive})`;
  }
}
