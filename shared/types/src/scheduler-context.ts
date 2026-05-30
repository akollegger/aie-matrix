/** Caller identity for the scheduler fiber and other elevated callers (e.g. admin console).
 *  Has no actor position — movement commands return NoActorOrigin when dispatched with this context. */
export interface SchedulerContext {
  readonly _tag: "SchedulerContext";
  readonly role: "system";
}

export function makeSchedulerContext(): SchedulerContext {
  return { _tag: "SchedulerContext", role: "system" };
}
