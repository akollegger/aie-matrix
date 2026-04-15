import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestTrace {
  readonly traceId: string;
}

const asyncTrace = new AsyncLocalStorage<RequestTrace>();

export function getRequestTraceId(): string | undefined {
  return asyncTrace.getStore()?.traceId;
}

/** Run `fn` with AsyncLocalStorage trace context (propagates through returned Promise chains in Node). */
export function runWithRequestTrace<A>(traceId: string, fn: () => A): A {
  return asyncTrace.run({ traceId }, fn);
}
