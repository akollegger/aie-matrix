# GitHub Branch Ruleset Checklist

This checklist matches the current repository workflow:

- spec-first changes
- feature branches from `main`
- pull requests required for `main`
- at least one maintainer review before merge
- DCO sign-off via `git commit -s`

Use two branch rulesets: one strict ruleset for `main`, and one focused ruleset for proposal branches.

## Ruleset 1: Protect `main`

Create a new branch ruleset targeting `main`.

### Targeting

- [ ] Ruleset name: `Protect main`
- [ ] Enforcement status: `Active`
- [ ] Target: `Branch`
- [ ] Branch name pattern: `main`

### Restrictions

- [ ] Block deletions
- [ ] Block force pushes

### Pull requests

- [ ] Require a pull request before merging
- [ ] Required approvals: `1`
- [ ] Dismiss stale pull request approvals when new commits are pushed
- [ ] Require approval of the most recent reviewable push
- [ ] Require conversation resolution before merging
- [ ] Do not require code owner review yet unless `.github/CODEOWNERS` is committed

### Status checks

- [ ] Leave status checks disabled until CI exists
- [ ] After CI exists, enable required status checks
- [ ] After CI is stable, require branches to be up to date before merging

Recommended required checks when available:

- `dco`
- `markdownlint`
- `links`

Optional later checks:

- `spellcheck`
- package smoke tests

### History

- [ ] Require linear history
- [ ] Allow squash merge
- [ ] Disable merge commits
- [ ] Disable rebase merge unless maintainers specifically want it

### Push permissions

- [ ] Restrict direct pushes to `main`
- [ ] Keep the bypass list as small as possible

Recommended initial bypass list:

- `@akollegger`

### Do not enable yet

- [ ] Do not require signed commits
- [ ] Do not require deployments to succeed

Notes:

- GitHub "Require signed commits" is not the same as DCO sign-off.
- Enforce DCO with a CI check or GitHub app instead of the signed-commit toggle.

## Ruleset 2: Proposal-only branches

Create a second branch ruleset targeting proposal branches.

### Targeting

- [ ] Ruleset name: `Proposal branches`
- [ ] Enforcement status: `Active`
- [ ] Target: `Branch`
- [ ] Branch name pattern: `proposal/*`

### Recommended settings

- [ ] Do not require pull requests on the proposal branch itself
- [ ] Require the `proposal-branch-scope` status check if you want proposal branches limited to `docs/` and `proposals/`
- [ ] Do not require signed commits
- [ ] Allow force pushes if maintainers want flexible draft iteration
- [ ] Do not block deletions unless you want to preserve stale draft branches

Rationale:

- Proposal branches are working branches for RFCs and ADRs.
- The strict control point should be merging into `main`, but proposal branches can still be scoped to documentation and proposal paths with a PR check.

Workflow reference:

- `.github/workflows/proposal-branch-scope.yml`
- Check name: `proposal-branch-scope`

Behavior:

- PRs from branches matching `proposal/*` fail if any changed file is outside `docs/` or `proposals/`
- PRs from other branch types are ignored by this check

## Follow-up

After `.github/CODEOWNERS` is in place, update the `main` ruleset:

- [ ] Enable `Require review from Code Owners`

If the maintainer set expands later, split ownership more narrowly:

- `docs/` for core docs maintainers
- `proposals/adr/` for architecture maintainers
- `proposals/rfc/` for product and architecture maintainers
