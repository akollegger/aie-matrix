// ---------------------------------------------------------------------------
// Mock fixtures for the admin ghost management panel preview
// ---------------------------------------------------------------------------

export const MOCK_MAPS = [
  {
    mapId: "conference-floor",
    name: "Conference Floor",
    status: "published",
    publishedAt: "2026-05-20T09:00:00Z",
  },
  {
    mapId: "hallway-north",
    name: "Hallway North",
    status: "published",
    publishedAt: "2026-05-20T09:05:00Z",
  },
  {
    mapId: "demo-room",
    name: "Demo Room",
    status: "archived",
    publishedAt: "2026-05-19T14:00:00Z",
    archivedAt: "2026-05-20T08:00:00Z",
  },
]

export const MOCK_SESSIONS = [
  {
    id: "main-session-001",
    name: "AIEWF Day 1",
    status: "active",
    startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    maps: [{ mapId: "conference-floor", role: "primary", gcsPath: "maps/conference-floor.map.gram" }],
  },
  {
    id: "hall-session-002",
    name: "Hallway Demo",
    status: "active",
    startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    maps: [{ mapId: "hallway-north", role: "primary", gcsPath: "maps/hallway-north.map.gram" }],
  },
]

// Helper: a minimal A2A agent card
function makeAgentCard(overrides: {
  name: string
  description: string
  url: string
  tier: "wanderer" | "listener" | "social"
  about: string
  streaming: boolean
  pushNotifications: boolean
}) {
  return {
    name: overrides.name,
    description: overrides.description,
    protocolVersion: "0.3.0",
    version: "1.0.0",
    url: overrides.url,
    capabilities: { streaming: overrides.streaming, pushNotifications: overrides.pushNotifications },
    skills: [
      {
        id: "world-navigation",
        name: "World Navigation",
        description: "Navigates the hex-tile world using MCP tools.",
        tags: ["navigation", "world"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    matrix: {
      schemaVersion: 1,
      tier: overrides.tier,
      ghostClasses: ["attendee"],
      requiredTools: ["whereami", "look", "go"],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: { about: overrides.about },
      authors: ["@akollegger"],
    },
  }
}

export const MOCK_CATALOG = [
  {
    agentId: "random-agent-pod-a1b2c",
    baseUrl: "http://random-agent-pod-a1b2c:4001",
    builtIn: true,
    registeredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    agentCard: makeAgentCard({
      name: "Random Agent (pod a1b2c)",
      description: "Reference Wanderer — random movement via MCP",
      url: "http://random-agent-pod-a1b2c:4001",
      tier: "wanderer",
      about: "Wanders randomly across the hex grid, exploring cells.",
      streaming: true,
      pushNotifications: false,
    }),
  },
  {
    agentId: "random-agent-pod-d3e4f",
    baseUrl: "http://random-agent-pod-d3e4f:4001",
    builtIn: true,
    registeredAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    agentCard: makeAgentCard({
      name: "Random Agent (pod d3e4f)",
      description: "Reference Wanderer — random movement via MCP",
      url: "http://random-agent-pod-d3e4f:4001",
      tier: "wanderer",
      about: "Wanders randomly across the hex grid, exploring cells.",
      streaming: true,
      pushNotifications: false,
    }),
  },
]

// Mutable in-memory ghost session store so spawn/shutdown work in the preview
export const MOCK_GHOST_SESSIONS: Array<{
  sessionId: string
  agentId: string
  ghostId: string
  status: string
  mcpToken: string  // present in raw store, stripped by agentHostClient before UI sees it
}> = [
  {
    sessionId: "01JDEMO000000000000GHOST1",
    agentId: "random-agent-pod-a1b2c",
    ghostId: "ghost-preview-alice",
    status: "running",
    mcpToken: "MOCK_MCP_TOKEN_MUST_NOT_RENDER",
  },
]

let houseCounter = 1
let caretakerCounter = 1
let ghostCounter = 10
let sessionCounter = 100

export function mockCreateHouse(_displayName: string) {
  return { agentHostId: `mock-house-${houseCounter++}` }
}

export function mockCreateCaretaker(_label: string) {
  return { caretakerId: `mock-caretaker-${caretakerCounter++}` }
}

export function mockAdopt(_caretakerId: string, _agentHostId: string) {
  const ghostId = `ghost-preview-${String.fromCharCode(97 + ghostCounter++ % 26)}${ghostCounter}`
  return {
    ghostId,
    credential: {
      token: `mock-token-${ghostId}`,
      worldApiBaseUrl: "http://localhost:8787/mcp",
    },
  }
}

export function mockSpawn(agentId: string, ghostId: string) {
  const sessionId = `01JDEMO${String(sessionCounter++).padStart(18, "0")}`
  MOCK_GHOST_SESSIONS.push({
    sessionId,
    agentId,
    ghostId,
    status: "running",
    mcpToken: "MOCK_MCP_TOKEN_MUST_NOT_RENDER",
  })
  return { sessionId, agentId, ghostId, mcpToken: "MOCK_MCP_TOKEN_MUST_NOT_RENDER" }
}

export function mockShutdown(sessionId: string) {
  const idx = MOCK_GHOST_SESSIONS.findIndex(s => s.sessionId === sessionId)
  if (idx !== -1) MOCK_GHOST_SESSIONS.splice(idx, 1)
}
