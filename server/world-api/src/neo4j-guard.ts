import { Data, Effect } from "effect";

export class Neo4jNotConfiguredError extends Data.TaggedError("Neo4jNotConfiguredError")<{
  readonly endpoint: string;
}> {}

/**
 * Fails with Neo4jNotConfiguredError when NEO4J_URI is not set.
 * Call at the top of any route handler that requires Neo4j.
 */
export function requireNeo4j(endpoint: string): Effect.Effect<void, Neo4jNotConfiguredError> {
  return process.env.NEO4J_URI?.trim()
    ? Effect.void
    : Effect.fail(new Neo4jNotConfiguredError({ endpoint }));
}
