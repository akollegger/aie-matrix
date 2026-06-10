import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { parseCharacterGramText, CharacterParseError } from "../src/catalog/parse-character-gram.js";

const VALID_CHARACTER = `
{ kind: "matrix-character" }

(charGuide:Character { id: "info-attendant", name: "Info Attendant",
  background: "A friendly guide to the conference.", enabled: true, defaultAction: "idle" })

(idle:DialogNode       { responses: ["Welcome! How can I help?", "Hello there!"] })
(directions:DialogNode { responses: ["Hall A is north, Hall B is south."] })

[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: ["where","map","location"] }]->(directions),
  (idle)-[:DialogTrigger { triggers: [] }]->(idle),
  (directions)-[:DialogTrigger { triggers: [] }]->(idle)
]

[behavior_1:Behaviors |
  (b1:Rule { when: "crowded", do: "avoid-crowd", priority: 1 }),
  (b2:Rule { when: "always",  do: "idle",        priority: 2 })
]

(charGuide)-[:HAS_DIALOG]->(dialog_1)
(charGuide)-[:EXHIBITS_BEHAVIOR]->(behavior_1)
`;

const DISABLED_CHARACTER = `
{ kind: "matrix-character" }

(charHermit:Character { id: "hermit", name: "The Hermit",
  background: "Prefers solitude.", enabled: false, defaultAction: "stay" })

(idle:DialogNode { responses: ["..."] })

[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: [] }]->(idle)
]

(charHermit)-[:HAS_DIALOG]->(dialog_1)
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

  it("parses dialog nodes into the tree's nodes map", async () => {
    const char = await parse(VALID_CHARACTER);
    const nodes = char.dialogTree.nodes;
    expect(nodes.size).toBe(2);
    expect(nodes.has("idle")).toBe(true);
    expect(nodes.has("directions")).toBe(true);
  });

  it("identifies the root node by its wildcard self-loop", async () => {
    const char = await parse(VALID_CHARACTER);
    expect(char.dialogTree.rootId).toBe("idle");
  });

  it("parses dialog tree edges with triggers", async () => {
    const char = await parse(VALID_CHARACTER);
    const edges = char.dialogTree.edges;
    const specificEdge = edges.find((e) => e.fromId === "idle" && e.toId === "directions");
    expect(specificEdge).toBeDefined();
    expect(specificEdge!.triggers).toContain("where");
    expect(specificEdge!.triggers).toContain("map");
  });

  it("includes the wildcard self-loop in edges", async () => {
    const char = await parse(VALID_CHARACTER);
    const selfLoop = char.dialogTree.edges.find(
      (e) => e.fromId === "idle" && e.toId === "idle" && e.triggers.length === 0,
    );
    expect(selfLoop).toBeDefined();
  });

  it("parses the dialog tree id from the block label", async () => {
    const char = await parse(VALID_CHARACTER);
    expect(char.dialogTree.id).toBe("dialog_1");
  });

  it("parses enabled: false correctly", async () => {
    const char = await parse(DISABLED_CHARACTER);
    expect(char.id).toBe("hermit");
    expect(char.enabled).toBe(false);
    expect(char.defaultAction).toBe("stay");
  });

  it("a character with no EXHIBITS_BEHAVIOR has empty behaviorRules", async () => {
    const char = await parse(DISABLED_CHARACTER);
    expect(char.behaviorRules).toHaveLength(0);
  });

  it("fails on missing kind header", async () => {
    const text = `
{ id: "test", name: "Test", background: "bg" }
(charTest:Character { id: "test", name: "Test", background: "bg", enabled: true, defaultAction: "idle" })
(idle:DialogNode { responses: ["ok"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charTest)-[:HAS_DIALOG]->(dialog_1)
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/kind/);
  });

  it("fails on wrong kind value", async () => {
    const text = `
{ kind: "matrix-map" }
(charTest:Character { id: "test", name: "Test", background: "bg", enabled: true, defaultAction: "idle" })
(idle:DialogNode { responses: ["ok"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charTest)-[:HAS_DIALOG]->(dialog_1)
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/matrix-character/);
  });

  it("fails on missing required Character fields", async () => {
    const text = `
{ kind: "matrix-character" }
(charTest:Character { id: "test" })
(idle:DialogNode { responses: ["ok"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charTest)-[:HAS_DIALOG]->(dialog_1)
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/missing required/);
  });

  it("fails on invalid defaultAction enum", async () => {
    const text = `
{ kind: "matrix-character" }
(charTest:Character { id: "test", name: "T", background: "b", enabled: true, defaultAction: "fly" })
(idle:DialogNode { responses: ["ok"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charTest)-[:HAS_DIALOG]->(dialog_1)
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/defaultAction/);
  });

  it("fails when no HAS_DIALOG relationship is present", async () => {
    const text = `
{ kind: "matrix-character" }
(charTest:Character { id: "test", name: "T", background: "b", enabled: true, defaultAction: "idle" })
(idle:DialogNode { responses: ["ok"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/HAS_DIALOG/);
  });

  it("fails when the dialog tree has no idle state (wildcard self-loop)", async () => {
    const text = `
{ kind: "matrix-character" }
(charTest:Character { id: "test", name: "T", background: "b", enabled: true, defaultAction: "idle" })
(idle:DialogNode  { responses: ["ok"] })
(other:DialogNode { responses: ["other"] })
[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: ["hello"] }]->(other),
  (other)-[:DialogTrigger { triggers: [] }]->(idle)
]
(charTest)-[:HAS_DIALOG]->(dialog_1)
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/idle state/);
  });

  it("fails when a dialog tree edge references an undefined DialogNode", async () => {
    const text = `
{ kind: "matrix-character" }
(charTest:Character { id: "test", name: "T", background: "b", enabled: true, defaultAction: "idle" })
(idle:DialogNode { responses: ["ok"] })
[dialog_1:DialogTree |
  (idle)-[:DialogTrigger { triggers: [] }]->(idle),
  (idle)-[:DialogTrigger { triggers: ["hi"] }]->(nonexistent)
]
(charTest)-[:HAS_DIALOG]->(dialog_1)
`;
    const err = await parseExpectError(text);
    expect(err.message).toMatch(/undefined DialogNode/);
  });
});
