import { test, expect } from "./fixtures.js";

test("say enters conversational mode; bye exits it", async ({ ghost }) => {
  const sayResult = (await ghost.mcp.callTool("say", {
    intent: "greet",
    content: "Hello, world!",
  })) as { message_id: string; mx_listeners: string[] };

  expect(typeof sayResult.message_id).toBe("string");
  expect(Array.isArray(sayResult.mx_listeners)).toBe(true);

  // Ghost is now in conversational mode — movement should be blocked
  let moveError: { error?: string; code?: string } | null = null;
  try {
    const ex = (await ghost.mcp.callTool("exits", {})) as { exits: Array<{ toward: string }> };
    await ghost.mcp.callTool("go", { toward: ex.exits[0].toward });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      moveError = JSON.parse(msg) as { error?: string; code?: string };
    } catch {
      // not JSON
    }
  }
  expect(moveError).not.toBeNull();
  expect(moveError!.code).toBe("IN_CONVERSATION");

  // Exit conversational mode
  const byeResult = (await ghost.mcp.callTool("bye", {})) as { previous_mode: string };
  expect(byeResult.previous_mode).toBe("conversational");

  // Movement should now succeed
  const ex = (await ghost.mcp.callTool("exits", {})) as { exits: Array<{ toward: string }> };
  const goResult = (await ghost.mcp.callTool("go", { toward: ex.exits[0].toward })) as {
    ok: boolean;
  };
  expect(goResult.ok).toBe(true);
});

test("nearby ghost receives say notification in inbox", async ({ ghost, ghost2 }) => {
  // Both ghosts spawn at the same anchor cell (AIE_MATRIX_TCK_MODE=1)
  await ghost.mcp.callTool("say", {
    intent: "greet",
    content: "Can anyone hear me?",
  });

  const inbox = (await ghost2.mcp.callTool("inbox", {})) as {
    notifications: Array<{ thread_id: string; message_id: string }>;
  };
  expect(inbox.notifications.length).toBeGreaterThan(0);

  // Clean up: exit conversational mode so fixture teardown can disconnect cleanly
  await ghost.mcp.callTool("bye", {});
});
