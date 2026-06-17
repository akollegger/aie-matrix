import type { ActorId, ResourceId } from "./ledger.js";

export type GroupId = string;

export interface AdmissionOffer {
  offerId: string;
  groupId: GroupId;
  prospectId: ActorId;
  resource: ResourceId;
  amount: number;
  expiresAt: number;
}

export interface AdmissionVote {
  voterId: ActorId;
  decision: "accept" | "reject";
  ts: number;
}

export interface VoteWindow {
  offer: AdmissionOffer;
  votes: AdmissionVote[];
}

export interface GroupSummary {
  groupId: GroupId;
  name: string;
  memberCount: number;
  myContribution: { resource: ResourceId; amount: number };
}

export interface GroupMessage {
  thread_id: GroupId;
  message_id: string;
  timestamp: string;
  role: "user" | "system";
  name: string;
  content: string;
  mx_tile: string;
  mx_listeners: ActorId[];
}
