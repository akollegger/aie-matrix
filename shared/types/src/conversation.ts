export interface MessageRecord {
  thread_id: string;
  message_id: string;
  timestamp: string;
  role: "user" | "partner";
  name: string;
  content: string;
  mx_tile: string;
  mx_listeners: string[];
}

export interface ConversationStore {
  append(record: MessageRecord): Promise<void>;
  get(thread_id: string, message_id: string): Promise<MessageRecord | null>;
  list(
    thread_id: string,
    options?: { after?: string; since?: string; limit?: number },
  ): Promise<MessageRecord[]>;
}

export interface PendingNotification {
  thread_id: string;
  message_id: string;
}

/** Sender of a conversation message in the intermedium conversation log. */
export type ConversationMessageSender = "human" | "ghost";

/** A single message in the ghost-house conversation log (served to the intermedium client). */
export interface ConversationMessage {
  readonly messageId: string;
  readonly sender: ConversationMessageSender;
  readonly content: string;
  readonly timestamp: string;
}
