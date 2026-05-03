/**
 * @see `specs/009-ghost-house-a2a/contracts/ic-006-spawn-context.md`
 */
export type SpawnContext = {
  readonly schema: "aie-matrix.ghost-house.spawn-context.v1";
  readonly ghostId: string;
  readonly houseEndpoints: { readonly mcp: string; readonly a2a: string };
  readonly token: string;
  readonly worldEntryPoint: string;
  readonly ghostCard: { class: string; displayName: string; partnerEmail: string | null };
  readonly expiresAt: string;
};
