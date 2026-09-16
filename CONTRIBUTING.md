# Contributing (Snowflake fork)

This repository (`Snowflake-Labs/ttvc`) is a **Snowflake-maintained fork of the open-source [`dropbox/ttvc`](https://github.com/dropbox/ttvc) package** (published to npm as `@dropbox/ttvc`). We carry Snowsight-specific fixes here — mostly around iframe and network-idle observation — and try to contribute them upstream when it makes sense, but this fork is the source of truth for what Snowsight actually runs.

Snowsight does **not** consume this package via a private npm publish. Instead, changes flow: `dev` → `snow-release` → a `pnpm patch` applied on top of the public `@dropbox/ttvc` npm package in the `snapps` repo. See below.

## Remotes

- `origin` — `Snowflake-Labs/ttvc` (this fork, where you push/PR).
- `upstream` — the original OSS repo. Add it once:

  ```
  git remote add upstream https://github.com/dropbox/ttvc.git
  ```

## Branch model

> NOTE: `main` is currently blocked as a merge target — see [Why `dev` instead of `main`](#why-dev-instead-of-main) below. Until that's resolved, `dev` is the working trunk in practice.

- **`main`** — mirrors the intended long-term trunk (and, historically, upstream). Not currently usable as a merge target for this fork's work.
- **`dev`** — the actual integration branch. Upstream syncs and all Snowflake-specific fixes get merged here. Always branch new work from an up-to-date `dev`.
- **`snow-release`** — tracks what's currently built into Snowsight. Never commit to it directly; it only ever advances by merging `dev` into it when a new build is ready to ship (see [Release to Snowsight](#release-to-snowsight) below).
- **Topic branches** — always branch from `dev`, not from another topic branch. Keep them short-lived: open a PR, get it reviewed, merge to `dev` promptly, then branch the next piece of work from the newly-updated `dev`. Don't stack branch B on top of unmerged branch A — if B depends on A's changes, wait for A to merge first, or rebase B onto `dev` once A lands.

### Why `dev` instead of `main`

As of 2026-09, merging/editing PRs against `main` via the GitHub API fails with `Unauthorized: As an Enterprise Managed User, you cannot access this content` — the GitHub App/OAuth client used for `gh` isn't approved for write operations in this org, and there was no available path to merge PRs into `main` through the UI either at the time this was set up. `dev` was created as a plain `git push`-only escape hatch (no PR merge required) so work could keep moving. If/when `main` access is restored, re-evaluate whether `dev` should be folded back into `main` and this doc updated accordingly — don't assume this split is permanent.

## Contribution workflow

1. Branch off `dev`.
2. Make your change, open a PR against `dev`.
3. CI (lint, unit, Playwright — already configured in `.github/workflows`) must pass.
4. Get it reviewed and merge to `dev`.

## Syncing upstream

Done ad hoc, whenever there's a useful change on `dropbox/ttvc` worth pulling in — there's no fixed cadence.

```
git remote add upstream https://github.com/dropbox/ttvc.git   # first time only
git fetch upstream
git checkout -b sync-upstream-dev dev
git merge upstream/main
```

Resolve any conflicts (check `package.json`'s `name`/`version`/`repository` fields in particular — keep this fork's values for `name`/`repository` if upstream has diverged, but take upstream's `version` bump if there's no fork-specific reason not to). Push the branch and open a PR against `dev` like any other change.

## Release to Snowsight

Snowsight doesn't install this package from npm directly — it installs the public `@dropbox/ttvc` npm package in the `snapps` repo, patched via [`pnpm patch`](https://pnpm.io/cli/patch) with our fork's changes.

1. Make sure the fixes you want shipped are merged to `dev`.
2. Fast-forward `snow-release` to `dev`:

   ```
   git checkout snow-release
   git merge dev
   git push
   ```

3. Build this repo: `yarn build` (produces `dist/` and `lib/`, per `package.json`'s `main`/`module`/`types` fields).
4. In the `snapps` repo, open an editable copy of the currently-installed package:

   ```
   pnpm patch @dropbox/ttvc
   ```

5. Copy this repo's freshly built `dist/` and `lib/` into that temp directory, overwriting the npm-published files.
6. Commit the patch:

   ```
   pnpm patch-commit <tmp-dir>
   ```

   This writes `patches/@dropbox__ttvc@<version>.patch` and records it under `pnpm.patchedDependencies` in `snapps`'s `package.json`.
7. Commit/PR the patch file and `package.json` change in `snapps`. Note the `snow-release` commit SHA in the commit message — the patch file itself is opaque, so this is the only breadcrumb back to the source change.
8. Repeat steps 4-7 the next time `snow-release` moves.
