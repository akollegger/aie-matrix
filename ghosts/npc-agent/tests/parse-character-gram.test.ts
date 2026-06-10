import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { parseCharacterGramText, CharacterParseError } from "../src/catalog/parse-character-gram.js";

const VALID_CHARACTER = `
{ kind: "matrix-character", id: "info-attendant", name: "Info Attendant",
  background: "A friendly guide to the conference.", enabled: true, defaultAction: "idle" }

(greet:DialogNode { trigger: ["hello","hi"], responses: ["Welcome! How can I help?", "Hello there!"] })
(directions:DialogNode { trigger: ["where","map","location"], responses: ["Hall A is north, Hall B is south."] })
(fallback:DialogNode { responses: ["I'm not sure about that. Try the info desk!"], fallback: true })

[dialog:DialogTree |
  (greet)-[:ON]->(directions),
  (directions)-[:ON]->(greet)
]

[behaviors:Behaviors |
  (b1:Rule { when: "crowded", do: "avoid-crowd", priority: 1 }),
  (b2:Rule { when: "always", do: "idle", priority: 2 })
]
`;

const DISABLED_CHARACTER = `
{ kind: "matrix-character", id: "hermit", name: "The Hermit",
  background: "Prefers solitude.", enabled: false, defaultAction: "stay" }

(fallback:DialogNode { responses: ["..."], fallback: true })

[dialog:DialogTree | ]
`;

async function parse(text: string) {
  return Effect.runPromise(parseCharacterGramText(text));
}

async function parseExpectError(text: string): Promise<CharacterParseError> {
  return Effect.runPromise(Effect.flip(parseCharacterGramText(text)));
}

describe("parseCharacterGramText", () => {
  it("parses a valid character to CharacterDefinition", async () => {
    const char = await parse(VALID_CHARACTER);
    expect(char.id).toBe("info-attendant");
    expect(char.name).toBe("Info Attendant");
    expect(char.background).toBe("A friendly guide to the conference.");
    expect(char.enabled).toBe(true);
    expect(char.defaultAction).toBe("idle");
  });

  it("parses behavior rules in priority order", async () => {
    const char = await parse(VALID_CHARACTER);
    expect(char.behaviorRules).toHaveLength(2);
    expect(char.behaviorRules[0]!.condition).toBe("crowded");
    expect(char.behaviorRules[0]!.action).toBe("avoid-crowd");
    expect(char.behaviorRules[1]!.condition).toBe("always");
    expect(char.behaviorRules[1]!.action).toBe("idle");
  });

  it("parses dialog nodes", async () => {
    const char = await parse(VALID_CHARACTER);
    const nodes = char.dialogTree.nodes;
    expect(nodes.size).toBe(3);
    expect(nodes.has("greet")).toBe(true);
    expect(nodes.has("directions")).toBe(true);
    expect(nodes.has("fallback")).toBe(true);
  });

  it("correctly identifies fallback node", async () => {
    const char = await parse(VALID_CHARACTER);
    expect(char.dialogTree.fallbackId).toBe("fallback");
    expect(char.dialogTree.nodes.get("fallback")?.fallback).toBe(true);
  });

  it("parses trigger conditions as arrays", async () => {
    const char = await parse(VALID_CHARACTER);
    const greet = char.dialogTree.nodes.get("greet")!;
    expect(greet.triggerConditions).toContain("hello");
    expect(greet.triggerConditions).toContain("hi");
  });

  it("applies dialog tree transitions", async () => {
    const char = await parse(VALID_CHARACTER);
    const greet = char.dialogTree.nodes.get("greet")!;
    expect(greet.transition).toBe("directions");
  });

  it("parses enabled: false correctly", async () => {
    const char = await parse(DISABLED_CHARACTER);
    expect(char.id).toBe("hermit");
    expect(char.enabled).toBe(false);
    expect(char.defaultAction).toBe("stay");
  });

  it("fails on missing kind header", async () => {
    const text = `
{ id: "test", name: "Test", background: "bg", enabled: true, defaultAction: "idle" }
(fallback:DialogNode { responses: ["ok"], fallback: true })
[dialog:DialogTree | ]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/kind/);
  });

  it("fails on wrong kind value", async () => {
    const text = `
{ kind: "matrix-map", id: "test", name: "Test", background: "bg", enabled: true, defaultAction: "idle" }
(fallback:DialogNode { responses: ["ok"], fallback: true })
[dialog:DialogTree | ]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/matrix-character/);
  });

  it("fails on missing required fields", async () => {
    const text = `
{ kind: "matrix-character", id: "test" }
(fallback:DialogNode { responses: ["ok"], fallback: true })
[dialog:DialogTree | ]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/missing required/);
  });

  it("fails on invalid defaultAction enum", async () => {
    const text = `
{ kind: "matrix-character", id: "test", name: "T", background: "b", enabled: true, defaultAction: "fly" }
(fallback:DialogNode { responses: ["ok"], fallback: true })
[dialog:DialogTree | ]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/defaultAction/);
  });

  it("fails when no fallback node exists", async () => {
    const text = `
{ kind: "matrix-character", id: "test", name: "T", background: "b", enabled: true, defaultAction: "idle" }
(greet:DialogNode { trigger: ["hi"], responses: ["hello"] })
[dialog:DialogTree | ]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/fallback/);
  });

  it("fails when transition target does not resolve", async () => {
    const text = `
{ kind: "matrix-character", id: "test", name: "T", background: "b", enabled: true, defaultAction: "idle" }
(greet:DialogNode { trigger: ["hi"], responses: ["hello"] })
(fallback:DialogNode { responses: ["hm?"], fallback: true })
[dialog:DialogTree |
  (greet)-[:ON]->(nonexistent)
]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/unresolved/);
  });
});
