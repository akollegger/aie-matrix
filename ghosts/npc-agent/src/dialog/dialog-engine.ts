import type { DialogTree, DialogState } from "../types.js";

export interface DialogResult {
  readonly response: string;
  readonly nextNodeId: string;
}

/**
 * Evaluate a single inbound message against the dialog tree.
 *
 * Scans all non-fallback nodes in tree insertion order for a case-insensitive
 * keyword/substring match in `triggerConditions`. First match wins. Falls back
 * to the fallback node on no match. Randomly selects a response string from the
 * matched node. Returns the new state node id (the matched node's `transition`
 * target, or the matched node itself when no transition is defined).
 */
export function evaluateDialog(
  tree: DialogTree,
  state: DialogState,
  inboundText: string,
): DialogResult {
  const lowerText = inboundText.toLowerCase().trim();

  // Find first node with a matching trigger (insertion order; fallback excluded).
  let matchedNodeId: string | undefined;
  for (const [nodeId, node] of tree.nodes) {
    if (node.fallback) continue;
    if (node.triggerConditions.length === 0) continue;
    for (const trigger of node.triggerConditions) {
      if (lowerText.includes(trigger.toLowerCase())) {
        matchedNodeId = nodeId;
        break;
      }
    }
    if (matchedNodeId !== undefined) break;
  }

  const respondingNodeId = matchedNodeId ?? tree.fallbackId;
  const respondingNode = tree.nodes.get(respondingNodeId);

  if (!respondingNode || respondingNode.responses.length === 0) {
    return { response: "...", nextNodeId: state.currentNodeId };
  }

  // Random response selection.
  const response =
    respondingNode.responses[Math.floor(Math.random() * respondingNode.responses.length)]!;

  // Follow the transition, with a cycle guard: don't self-loop or follow to a missing node.
  const rawNext = respondingNode.transition;
  const nextNodeId =
    rawNext !== undefined && rawNext !== respondingNodeId && tree.nodes.has(rawNext)
      ? rawNext
      : respondingNodeId;

  return { response, nextNodeId };
}

/** Initialize a fresh dialog state for a new conversation partner. */
export function initialDialogState(tree: DialogTree): DialogState {
  return { currentNodeId: tree.rootId, lastUpdated: new Date().toISOString() };
}
