import { describe, it, expect } from "vitest";
import { translateColyseusWorldV1 } from "../../src/colyseus-bridge/translate-world-v1.js";

describe("translateColyseusWorldV1", () => {
  it("maps message.new to IC-004", () => {
    const e = translateColyseusWorldV1({
      t: "message.new",
      targetGhostId: "01JARKZP8T0T4T7W8D8V8B8B00",
      payload: { from: "x", role: "partner", priority: "PARTNER", text: "hi" },
    });
    expect(e).not.toBeNull();
    expect(e?.schema).toBe("aie-matrix.world-event.v1");
    expect(e?.kind).toBe("world.message.new");
    expect(e?.ghostId).toBe("01JARKZP8T0T4T7W8D8V8B8B00");
    expect((e?.payload as { text?: string }).text).toBe("hi");
  });
});
