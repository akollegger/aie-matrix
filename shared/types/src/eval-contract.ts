export type EvalContractId = string;

export type EvalContractState =
  | "Draft"
  | "Open"
  | "Accepted"
  | "Declined"
  | "Submitted"
  | "Expired"
  | "Evaluated"
  | "Settled";

export interface EvalContract {
  id: EvalContractId;
  clientId: string;       // ActorId
  contractorId: string;   // ActorId | GroupId
  evaluatorId: string;    // ActorId
  request: string;
  submission: string | null;
  stakeResource: string;  // ResourceId
  stakeAmount: number;
  deadline: number;       // Unix ms
  state: EvalContractState;
  verdict: number | null;
  beneficiaries: string[]; // ActorId[]
  openedAt: number;       // Unix ms
  escrowActorId: string;  // "escrow:<id>"
}
