import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Data, Effect } from "effect";

export class AdminAuthError extends Data.TaggedError("AdminAuthError")<{
  readonly reason: "missing" | "invalid";
}> {}

export const checkAdminToken = (req: IncomingMessage): Effect.Effect<void, AdminAuthError> =>
  Effect.gen(function* () {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      yield* Effect.fail(new AdminAuthError({ reason: "missing" }));
      return;
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      yield* Effect.fail(new AdminAuthError({ reason: "invalid" }));
      return;
    }

    const supplied = Buffer.from(token);
    const expected = Buffer.from(adminToken);

    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      yield* Effect.fail(new AdminAuthError({ reason: "invalid" }));
    }
  });
