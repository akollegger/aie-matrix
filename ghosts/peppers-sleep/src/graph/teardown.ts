/**
 * Tear down the AGA session at script exit.
 *
 * Every script that creates / re-uses `peppers-sleep-dev` (or any
 * other named AGA session) should call this in its `finally` block.
 * Without it, the session lingers for its `ttl` and burns compute
 * time we're paying for.
 *
 * Returns true if a delete succeeded, false if the session wasn't
 * there (no-op). Swallows the call's own errors so an exit-time
 * cleanup never masks the script's original failure.
 */

import type { Session } from "neo4j-driver";

export async function deleteAgaSession(
  session: Session,
  sessionName: string,
): Promise<boolean> {
  try {
    const res = await session.run(
      `CALL gds.session.delete($name) YIELD deleted RETURN deleted`,
      { name: sessionName },
    );
    const deleted = res.records[0]?.get("deleted");
    return Boolean(deleted);
  } catch (err) {
    console.warn(
      `[teardown] gds.session.delete('${sessionName}') failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
