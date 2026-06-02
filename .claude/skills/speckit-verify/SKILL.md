---
name: "speckit-verify"
description: "Gate check before opening a PR: clean build, all tests (unit + integration), spec coverage, doc impact, and a go/no-go verdict. Run after /speckit.implement and before opening a pull request."
argument-hint: "Optional: --skip-integration to skip Neo4j container startup"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "akollegger"
  source: "local"
user-invocable: true
disable-model-invocation: true
---

## User Input

```text
$ARGUMENTS
```

Parse flags from user input:
- `--skip-integration`: skip Neo4j container startup and integration test run

## Goal

Verify that all implementation work is complete and correct before a pull request is opened. Produces a structured go/no-go verdict. Every gate that fails blocks the PR.

This skill implements the **pre-PR quality gate** required by the project constitution (v1.2.1+).

---

## Execution Steps

### 1. Setup

Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root. Parse `FEATURE_DIR` and `BRANCH`. If it fails, halt with instructions to run `/speckit.implement` first.

### 2. Load Context

Read from `FEATURE_DIR`:
- `spec.md` — extract Functional Requirements (FR-NNN lines) and Documentation Impact section
- `tasks.md` — extract all tasks with `[x]` (complete) and `[ ]` (incomplete)
- `plan.md` — extract tech stack for integration test detection

### 3. Gate 1 — Clean Build

```bash
pnpm run build
```

- **PASS**: exits 0, no `error TS` output
- **FAIL**: any TypeScript error or non-zero exit

Report exact error lines on failure. Do not proceed to further gates if this fails — the branch is not buildable.

### 4. Gate 2 — Unit Tests

```bash
pnpm test
```

- **PASS**: exits 0, zero `fail` lines
- **FAIL**: any test failure or non-zero exit

Report which packages have failures. Pre-existing failures on `main` do not excuse failures on this branch — all tests must pass.

### 5. Gate 3 — Integration Tests (conditional)

**Skip if** `--skip-integration` flag is set. Otherwise:

#### 5a. Detect integration test files

```bash
find . -name "*.integration.test.ts" -not -path "*/node_modules/*" -not -path "*/dist/*"
```

If none found, mark Gate 3 as SKIP (no integration tests exist).

#### 5b. Detect container runtime

Check for `podman` first (preferred on this machine), then `docker`:

```bash
which podman 2>/dev/null || which docker 2>/dev/null
```

If neither found, mark Gate 3 as WARN (cannot start containers; advise running manually).

#### 5c. Check if Neo4j is already running

```bash
# Check for an existing neo4j container or a listening bolt port
podman ps --format "{{.Names}}" 2>/dev/null | grep -i neo4j || \
nc -z localhost 7687 2>/dev/null && echo "bolt-open"
```

#### 5d. Start Neo4j if needed

If Neo4j is NOT already running:

```bash
# Use podman if available, otherwise docker
CONTAINER_CMD=$(which podman 2>/dev/null || which docker)
$CONTAINER_CMD run -d \
  --name speckit-verify-neo4j \
  -p 7687:7687 \
  -p 7474:7474 \
  -e NEO4J_AUTH=neo4j/devpassword \
  neo4j:5
```

Wait for bolt to be ready (poll with `nc -z localhost 7687` up to 60s).

Set `NEO4J_STARTED_BY_SKILL=true` so we know to stop it afterwards.

Credentials to use: `NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=devpassword`

#### 5e. Run integration tests

Find packages that have a `test:integration` script and `*.integration.test.ts` files:

```bash
find . -name "package.json" -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.claude/*" \
  | xargs grep -l '"test:integration"' 2>/dev/null
```

For each such package, run its integration tests separately:

```bash
NEO4J_URI=bolt://localhost:7687 \
NEO4J_USER=neo4j \
NEO4J_PASSWORD=devpassword \
pnpm --filter <package-name> exec \
  node --import tsx --test "test/LedgerService.integration.test.ts"

NEO4J_URI=bolt://localhost:7687 \
NEO4J_USER=neo4j \
NEO4J_PASSWORD=devpassword \
pnpm --filter <package-name> exec \
  node --import tsx --test "test/GroupService.integration.test.ts"
```

**Important**: run each test file individually, not via the `test:integration` glob script.
Node's test runner runs multiple files as parallel workers; when combined with background output
capture this causes some results to be lost. Running files one-at-a-time avoids this.

- **PASS**: all packages exit 0
- **FAIL**: any non-zero exit

#### 5f. Stop container if we started it

```bash
if [ "$NEO4J_STARTED_BY_SKILL" = "true" ]; then
  $CONTAINER_CMD stop speckit-verify-neo4j
  $CONTAINER_CMD rm speckit-verify-neo4j
fi
```

### 6. Gate 4 — Spec Coverage

Check that every Functional Requirement in `spec.md` has at least one completed task (`[x]`) in `tasks.md`.

- Extract all `**FR-NNN**:` lines from `spec.md`
- For each FR-NNN, search `tasks.md` for any `[x]` task line that references `FR-NNN` OR is in a phase that covers the requirement (use keyword matching against the FR description if explicit ID references are absent)
- **PASS**: all FRs have at least one completed task
- **WARN**: FRs with no matching completed task (warn, not block — some FRs map to infra tasks that don't mention the FR explicitly)

Also check: are there any `[ ]` (incomplete) tasks remaining?
- **PASS**: zero incomplete tasks
- **FAIL**: any incomplete tasks

### 7. Gate 5 — Documentation Impact

Read the `## Documentation Impact` section from `spec.md`. Extract each bullet that names a file or path (not "None").

For each named file:
- Check it exists: `test -f <path>`
- Check it was modified on this branch: `git diff main...HEAD --name-only | grep <basename>`

- **PASS**: all named files exist and appear in the branch diff
- **WARN**: file exists but not in branch diff (may have been intentionally skipped — warn, don't block)
- **FAIL**: file does not exist

### 8. Produce Verdict

Output a structured report:

```
## speckit-verify Report
Branch: <branch>
Feature: <FEATURE_DIR>

| Gate | Status | Details |
|------|--------|---------|
| 1. Build        | ✅ PASS / ❌ FAIL | ... |
| 2. Unit Tests   | ✅ PASS / ❌ FAIL | ... |
| 3. Integration  | ✅ PASS / ⚠️ WARN / ⏭️ SKIP | ... |
| 4. Spec Coverage| ✅ PASS / ⚠️ WARN / ❌ FAIL | ... |
| 5. Doc Impact   | ✅ PASS / ⚠️ WARN / ❌ FAIL | ... |

## Verdict: ✅ GO / ❌ NO-GO

<reason if NO-GO>
```

**GO** requires Gates 1, 2, and 4 (incomplete tasks check) to all PASS. Gates 3 and 5 can WARN without blocking.

**NO-GO** if any of: build fails, unit tests fail, incomplete tasks remain.

### 9. Next Step Suggestion

- **GO**: "Branch is PR-ready. Run `/speckit.git.remote` or `gh pr create` to open the PR."
- **NO-GO**: List the specific failing gates and what to fix.

---

## Notes

- Always run from the repository root (where `pnpm-workspace.yaml` lives)
- Integration tests run sequentially per package to avoid interleaved output from Node's test reporter
- If the Neo4j container fails to start, Gate 3 is WARN not FAIL — record the error and advise manual run
- The `speckit-verify-neo4j` container name is deterministic so a stale container from a crashed previous run can be detected and removed before starting fresh
