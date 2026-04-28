/**
 * Human-spectator conversation API (HTTP stub until ghost house ships routes).
 *
 * @see `specs/011-intermedium-client/contracts/ic-002-a2a-conversation-subscription.md`
 */

import type { ConversationMessage } from "../types/conversation.js";

const defaultHeaders = (): Record<string, string> => {
  const token = import.meta.env.VITE_GHOST_HOUSE_BEARER;
  if (token && String(token).length > 0) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
};

function messagesUrl(ghostHouseUrl: string, ghostId: string, since?: string): string {
  const u = new URL(
    `conversation/${encodeURIComponent(ghostId)}/messages`,
    ghostHouseUrl.endsWith("/") ? ghostHouseUrl : `${ghostHouseUrl}/`,
  );
  if (since) {
    u.searchParams.set("since", since);
  }
  return u.toString();
}

function sendUrl(ghostHouseUrl: string, ghostId: string): string {
  return new URL(
    `conversation/${encodeURIComponent(ghostId)}/messages`,
    ghostHouseUrl.endsWith("/") ? ghostHouseUrl : `${ghostHouseUrl}/`,
  ).toString();
}

export type FetchMessagesResult =
  | { readonly isAvailable: true; readonly messages: readonly ConversationMessage[]; readonly ghostId: string }
  | { readonly isAvailable: false };

/**
 * `GET /conversation/:ghostId/messages`
 */
export async function fetchConversationMessages(
  ghostHouseUrl: string,
  ghostId: string,
  since?: string,
): Promise<FetchMessagesResult> {
  if (!ghostHouseUrl) {
    return { isAvailable: false };
  }
  try {
    const res = await fetch(messagesUrl(ghostHouseUrl, ghostId, since), {
      headers: { ...defaultHeaders(), Accept: "application/json" },
    });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return { isAvailable: false };
    }
    if (!res.ok) {
      return { isAvailable: false };
    }
    const data = (await res.json()) as { ghostId?: string; messages?: ConversationMessage[] };
    return {
      isAvailable: true,
      ghostId: data.ghostId ?? ghostId,
      messages: data.messages ?? [],
    };
  } catch {
    return { isAvailable: false };
  }
}

export type SendResult =
  | { readonly ok: true; readonly message: ConversationMessage }
  | { readonly ok: false; readonly isAvailable: false };

/**
 * `POST /conversation/:ghostId/messages` — `{ "content": "…" }`
 */
export async function sendConversationMessage(
  ghostHouseUrl: string,
  ghostId: string,
  content: string,
): Promise<SendResult> {
  if (!ghostHouseUrl) {
    return { ok: false, isAvailable: false };
  }
  try {
    const res = await fetch(sendUrl(ghostHouseUrl, ghostId), {
      method: "POST",
      headers: {
        ...defaultHeaders(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    if (res.status === 404 || !res.ok) {
      return { ok: false, isAvailable: false };
    }
    const message = (await res.json()) as ConversationMessage;
    return { ok: true, message };
  } catch {
    return { ok: false, isAvailable: false };
  }
}
