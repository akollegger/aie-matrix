export type SpawnContext = {
  readonly schema: "aie-matrix.agent-host.spawn-context.v1";
  readonly ghostId: string;
  readonly worldEntryPoint: string;
  readonly houseEndpoints: { readonly mcp: string; readonly a2a: string };
  readonly token: string;
  readonly expiresAt: string;
};
