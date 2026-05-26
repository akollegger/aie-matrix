/**
 * @aie-matrix/ghost-rdc-ledger
 *
 * Cyphers (in-world saloon token) + bounty board for the Red Dead
 * Convention ghost-house. In-memory ledger with optional file-backed
 * JSON persistence. Atomic transfers, escrowed bounty placements.
 */

export { Ledger, type LedgerOptions } from "./ledger.js";
export type {
  Bounty,
  LedgerEvent,
  LedgerError,
  LedgerResult,
  LedgerSnapshot,
  SkillProfile,
  SkillTier,
} from "./types.js";
