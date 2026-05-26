export {
  BarnacleSupervisor,
  BarnacleSupervisorLayer,
  makeBarnacleSupervisor,
  type IBarnacleSupervisor,
  type BarnacleSupervisorDeps,
} from "./BarnacleSupervisorService.js";
export type {
  BarnacleSessionRecord,
  BeginBarnacleSessionInput,
  BeginSessionResult,
  BeginSessionFailure,
} from "./types.js";
export {
  startBarnacleEncounterTrigger,
  type EncounterTriggerOptions,
  type EncounterTriggerHandle,
} from "./encounter-trigger.js";
