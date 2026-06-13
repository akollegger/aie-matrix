# IC-003: `handleContractSubmitted` event routing

**Contract**: The `handleContractSubmitted` function in `funder-behavior.ts` is called by `executor.ts` when a `world.contract.submitted` world event is received, to evaluate the contract and pay the contractor.

**Signature**:
```ts
export async function handleContractSubmitted(
  contractId: string,
  contractorId: string,
): Promise<void>
```

**Behavior**:
1. Looks up the funder `ghostId` via `contractToFunder.get(contractId)`.
2. If no match, returns silently (stale event after re-spawn).
3. Retrieves the active `GhostMcpClient` for that ghostId from `mcpByGhostId` (imported from executor or passed as a dependency).
4. Calls `eval_contract_evaluate` with `verdict: 1.0`.
5. Notifies the contractor via `say`.
6. Decrements `openContractCount`, clears `contractToFunder`, resets `ghostState` to `idle`.

**Called from**: `executor.ts` event dispatch, in the `world.contract.submitted` branch of `asWorldEvent` handling.  
**Note**: The `mcpByGhostId` map is owned by `executor.ts`. `handleContractSubmitted` must either import it from executor (if exported) or accept it as a parameter. Preferred: accept `mcpByGhostId: Map<string, GhostMcpClient>` as a parameter to avoid circular import.
