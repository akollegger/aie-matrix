/**
 * @see `specs/009-agent-host-a2a/contracts/ic-006-spawn-context.md`
 */
export type SpawnContext = {
  readonly schema: "aie-matrix.agent-host.spawn-context.v1";
  readonly ghostId: string;
  readonly houseEndpoints: {
    readonly mcp: string;
    readonly a2a: string;
    /** World-api registry base URL (optional for backwards compat
     *  with older agent-host versions that didn't include it). */
    readonly registry?: string;
  };
  readonly token: string;
  readonly worldEntryPoint: string;
  readonly ghostCard: { class: string; displayName: string; partnerEmail: string | null };
  readonly expiresAt: string;
};

// RFC-0019 Barnacle Protocol schemas — peppers ↔ supervisor messaging.
// Canonical definitions live in `@aie-matrix/shared-types` so both
// peppers (the conformer) and ghost-house's supervisor (the consumer)
// can speak them without a cross-package dependency. Re-exported here
// for downstream consumers that already import from this package.
export {
  PEPPERS_PAUSE_SCHEMA,
  PEPPERS_RESUME_SCHEMA,
  PLATFORM_ENCOUNTER_SCHEMA,
  type PeppersPause,
  type PeppersResume,
  type PlatformEncounter,
  type PlatformEncounterReply,
} from "@aie-matrix/shared-types";
