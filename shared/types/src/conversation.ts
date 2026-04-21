export interface MessageRecord {
  thread_id: string;
  message_id: string;
  timestamp: string;
  role: "user";
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
    options?: { after?: string; limit?: number },
  ): Promise<MessageRecord[]>;
}

export interface PendingNotification {
  thread_id: string;
  message_id: string;
}
