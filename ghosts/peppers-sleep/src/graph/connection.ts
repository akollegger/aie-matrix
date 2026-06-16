/**
 * Direct Neo4j driver connection.
 *
 * Sleep machinery is a substrate-level ETL process, not an agent
 * action. The `neo4j-agent-memory` MCP `graph_query` tool is
 * deliberately read-only — it protects the agent from corrupting
 * its own memory via free Cypher. Sleep needs to write
 * (`:Consolidation`, `:Skill`, label changes, `[:CONSOLIDATED_TO]` /
 * `[:DISTILLED_TO]` / `[:CONTRADICTS]` edges) AND it needs to call
 * GDS / AGA procedures. Both require direct driver access.
 *
 * The same env vars the agent-memory MCP uses
 * (`GHOST_MINDS_NEO4J_URI` / `_USERNAME` / `_PASSWORD` / `_DATABASE`)
 * point at the same Aura instance.
 *
 * This module is the ONLY place in `peppers-sleep` that instantiates
 * a driver; everything downstream takes a `Driver` or `Session`
 * passed in. That makes the package portable: an agent-memory PR
 * could swap this single file for the Python equivalent (the
 * agent-memory package already manages its own driver) without
 * touching any pipeline code.
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";

export interface SleepDriverOptions {
  readonly uri: string;
  readonly username: string;
  readonly password: string;
  readonly database?: string;
}

export function openDriver(opts: SleepDriverOptions): Driver {
  return neo4j.driver(
    opts.uri,
    neo4j.auth.basic(opts.username, opts.password),
    {
      // Conservative defaults — sleep cycles are bounded work, not
      // long-running services. We don't want connection pools to
      // hold open after a sleep finishes.
      maxConnectionPoolSize: 8,
      connectionAcquisitionTimeout: 30_000,
    },
  );
}

export function openSession(driver: Driver, database?: string): Session {
  return driver.session(database !== undefined ? { database } : undefined);
}

/** Pull the four standard env vars (set by `@aie-matrix/root-env` /
 *  `.env`) and open a session. Convenience for scripts. */
export async function openSessionFromEnv(): Promise<{
  readonly driver: Driver;
  readonly session: Session;
  readonly close: () => Promise<void>;
}> {
  const uri = requireEnv("GHOST_MINDS_NEO4J_URI");
  const username = requireEnv("GHOST_MINDS_NEO4J_USERNAME");
  const password = requireEnv("GHOST_MINDS_NEO4J_PASSWORD");
  const database = process.env.GHOST_MINDS_NEO4J_DATABASE;
  const driver = openDriver({ uri, username, password, database });
  const session = openSession(driver, database);
  return {
    driver,
    session,
    close: async () => {
      await session.close();
      await driver.close();
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}
