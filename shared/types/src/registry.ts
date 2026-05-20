/** AgentHost registration (IC-001). */
export interface RegisterAgentHostRequest {
  displayName: string;
  /** Optional callback or base URL for dev; PoC may omit. */
  baseUrl?: string;
}

export interface RegisterAgentHostResponse {
  agentHostId: string;
  registeredAt: string;
}

/** Caretaker-scoped adoption (IC-001 / IC-002). */
export interface AdoptGhostRequest {
  caretakerId: string;
  agentHostId: string;
  /** PoC may ignore when a single template ghost is implied. */
  ghostTemplateId?: string;
}

export interface GhostSessionCredential {
  /** Bearer token or opaque secret accepted by `world-api` / `auth`. */
  token: string;
  worldApiBaseUrl: string;
  transport: "http" | "stdio";
}

export interface AdoptGhostResponse {
  ghostId: string;
  caretakerId: string;
  credential: GhostSessionCredential;
}

export type RegistryErrorCode =
  | "UNKNOWN_CARETAKER"
  | "UNKNOWN_GHOST_HOUSE"
  | "CARETAKER_ALREADY_HAS_GHOST"
  | "GHOST_ALREADY_ADOPTED"
  | "REASSIGNMENT_NOT_ALLOWED";

export interface RegistryErrorBody {
  error: RegistryErrorCode;
  message: string;
}
