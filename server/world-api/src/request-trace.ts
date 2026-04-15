import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "effect";
import * as FiberRef from "effect/FiberRef";

export interface RequestTrace {
  readonly traceId: string;
}

const asyncTrace = new AsyncLocalStorage<RequestTrace>();

/**
 * Optional FiberRef mirror of the HTTP trace id (see {@link withRequestTraceFiber}). MCP tools run
 * nested `Effect.runPromise` calls from the SDK and do **not** inherit this ref; logs there use
 * {@link getRequestTraceId} (AsyncLocalStorage) instead.
 */
export const requestTraceIdRef = FiberRef.unsafeMake<string>("");

export function getRequestTraceId(): string | undefined {
  const fromAls = asyncTrace.getStore()?.traceId;
  if (fromAls) {
    return fromAls;
  }
  return undefined;
}

/** Run `fn` with AsyncLocalStorage trace context (propagates through returned Promise chains in Node). */
export function runWithRequestTrace<A>(traceId: string, fn: () => A): A {
  return asyncTrace.run({ traceId }, fn);
}

/** Scope an Effect to a request trace id (FiberRef + ALS when composed with {@link runWithRequestTrace}). */
export function withRequestTraceFiber<A, E, R>(traceId: string, program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.locally(requestTraceIdRef, traceId)(program);
}
