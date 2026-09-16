# AGENTS.md

Context for coding agents working in this repo. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full human-readable process this summarizes.

## What this repo is

`Snowflake-Labs/ttvc` is a Snowflake-maintained fork of the open-source [`dropbox/ttvc`](https://github.com/dropbox/ttvc) (`@dropbox/ttvc` on npm). Snowflake-specific fixes live here (mostly iframe/network-idle observation, for Snowsight). Snowsight consumes this via a `pnpm patch` on top of the public npm package in the `snapps` repo — not via a private npm publish.

## Branch model — use `dev`, not `main`

- **`dev`** is the actual working trunk. Branch new work from `dev`, open PRs against `dev`.
- **`main`** is not currently usable as a merge target for this fork (see "Known blocker" below) — don't branch from it or target PRs at it unless a human has confirmed that's changed.
- **`snow-release`** tracks what's built into Snowsight. Only ever advanced by merging `dev` into it — never commit to it directly.
- Branch from `dev` only, never from another unmerged topic branch (avoid re-creating the PR-stacking problem this repo just cleaned up).

## Known blocker: GitHub API writes are restricted here

`gh pr create`, `gh pr edit`, and `gh pr merge` (and the equivalent REST/GraphQL calls) fail with:

```
Unauthorized: As an Enterprise Managed User, you cannot access this content
```

This is an org-level EMU (Enterprise Managed User) policy blocking OAuth/CLI-app write access, not a bug in your invocation and not something you can work around with different flags or auth methods — don't spend time debugging it. Reads (`gh pr list`, `gh pr view`, `gh api ... GET`) work fine.

**What to do instead:**
- `git push` over SSH works normally — do your git work (branch, commit, push) as usual.
- For PRs against `dev`: push your branch and tell the user to open/merge the PR themselves, since you can't.
- Because `dev` itself was set up specifically as a git-push-only escape hatch, merging a small/low-risk change directly into `dev` with `git merge` + `git push` (skipping the PR) is an accepted pattern here when the user asks for it — it's how `dev` itself, the PR-stack cleanup, and this file were merged in. Don't do this unprompted for anything non-trivial; check with the user first.

## Syncing upstream

```
git remote add upstream https://github.com/dropbox/ttvc.git   # if not already added
git fetch upstream
git checkout -b sync-upstream-dev dev
git merge upstream/main
```

Watch `package.json`'s `name`/`version`/`repository` fields for conflicts.

## Build & test

```
yarn build          # dist/ + lib/
yarn test:lint
yarn test:typecheck
yarn test:unit
yarn test:e2e        # playwright
```

Run lint + typecheck + unit at minimum before considering iframe/network-idle-observer changes (`src/networkIdleObservable.ts`, `src/inViewportMutationObserver.ts`, `src/util/iframe.ts`) done — this area has had several rounds of overlapping fixes and is easy to regress silently.

## Release to Snowsight

`dev` → merge into `snow-release` → `yarn build` → in `snapps`: `pnpm patch @dropbox/ttvc`, copy in the built `dist/`/`lib/`, `pnpm patch-commit`. Full steps in [CONTRIBUTING.md](./CONTRIBUTING.md#release-to-snowsight).
