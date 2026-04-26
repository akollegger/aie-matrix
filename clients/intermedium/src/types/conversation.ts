/**
 * @see `specs/011-intermedium-client/data-model.md` (ConversationMessage, ConversationThread)
 */

export type MessageSender = "human" | "ghost";

export interface ConversationMessage {
  readonly messageId: string;
  readonly sender: MessageSender;
  readonly content: string;
  readonly timestamp: string;
}

export interface ConversationThread {
  readonly ghostId: string;
  readonly messages: readonly ConversationMessage[];
  readonly isLoading: boolean;
  readonly isAvailable: boolean;
}
