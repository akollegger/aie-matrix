import type { DialogTree, DialogState } from "../types.js";

export interface DialogResult {
  readonly response: string;
  readonly nextNodeId: string;
}

/**
 * Evaluate a single inbound message against the dialog FSM.
 *
 * From the current state node, scan outgoing edges in declaration order:
 * specific-trigger edges first (non-empty `triggers`), wildcard edge last
 * (`triggers: []`). First match wins. The response is chosen randomly from
 * the TARGET node's `responses`. State advances to the target node.
 *
 * Every valid tree has a wildcard edge from every node, so a match is always
 * guaranteed. The idle/root node's wildcard edge is a self-loop.
 */
export function evaluateDialog(
  tree: DialogTree,
  state: DialogState,
  inboundText: string,
): DialogResult {
  const lowerText = inboundText.toLowerCase().trim();

  const outgoing = tree.edges.filter((e) => e.fromId === state.currentNodeId);

  let matchedToId: string | undefined;

  // Specific triggers first (non-empty), in declaration order.
  for (const edge of outgoing) {
    if (edge.triggers.length === 0) continue;
    for (const trigger of edge.triggers) {
      if (lowerText.includes(trigger.toLowerCase())) {
        matchedToId = edge.toId;
        break;
      }
    }
    if (matchedToId !== undefined) break;
  }

  // Wildcard fallback.
  if (matchedToId === undefined) {
    const wildcard = outgoing.find((e) => e.triggers.length === 0);
    matchedToId = wildcard?.toId ?? state.currentNodeId;
  }

  const targetNode = tree.nodes.get(matchedToId);
  if (!targetNode || targetNode.responses.length === 0) {
    return { response: "...", nextNodeId: state.currentNodeId };
  }

  const response =
    targetNode.responses[Math.floor(Math.random() * targetNode.responses.length)]!;

  return { response, nextNodeId: matchedToId };
}

/** Initialize a fresh dialog state for a new conversation partner. */
export function initialDialogState(tree: DialogTree): DialogState {
  return { currentNodeId: tree.rootId, lastUpdated: new Date().toISOString() };
}
