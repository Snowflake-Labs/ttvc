# Contributing (Snowflake fork)

This repository (`Snowflake-Labs/ttvc`) is a **Snowflake-maintained fork of the open-source [`dropbox/ttvc`](https://github.com/dropbox/ttvc) package** (published to npm as `@dropbox/ttvc`). We carry Snowsight-specific fixes here — mostly around iframe and network-idle observation — and try to contribute them upstream when it makes sense, but this fork is the source of truth for what Snowsight actually runs.

Snowsight does **not** consume this package via a private npm publish. Instead, changes flow: `main` → `snow-release` → a `pnpm patch` applied on top of the public `@dropbox/ttvc` npm package in the `snapps` repo. See below.

## Remotes

- `origin` — `Snowflake-Labs/ttvc` (this fork, where you push/PR).
- `upstream` — the original OSS repo. Add it once:

  ```
  git remote add upstream https://github.com/dropbox/ttvc.git
  ```

## Branch model

- **`main`** — the stable trunk. All Snowflake-specific fixes and upstream syncs land here via PR. Always branch new work from an up-to-date `main`.
- **`snow-release`** — tracks what's currently built into Snowsight. Never commit to it directly; it only ever advances by merging `main` into it when a new build is ready to ship (see [Release to Snowsight](#release-to-snowsight) below).
- **Topic branches** — always branch from `main`, not from another topic branch. Keep them short-lived: open a PR, get it reviewed, merge to `main` promptly, then branch the next piece of work from the newly-updated `main`. Don't stack branch B on top of unmerged branch A — if B depends on A's changes, wait for A to merge first, or rebase B onto `main` once A lands.

## Contribution workflow

1. Branch off `main`.
2. Make your change, open a PR against `main`.
3. CI (lint, unit, Playwright — already configured in `.github/workflows`) must pass.
4. Get it reviewed and merge to `main`.

## Syncing upstream

Done ad hoc, whenever there's a useful change on `dropbox/ttvc` worth pulling in — there's no fixed cadence.

```
git remote add upstream https://github.com/dropbox/ttvc.git   # first time only
git fetch upstream
git checkout -b sync-upstream-main main
git merge upstream/main
```

Resolve any conflicts (check `package.json`'s `name`/`version`/`repository` fields in particular — keep this fork's values for `name`/`repository` if upstream has diverged, but take upstream's `version` bump if there's no fork-specific reason not to). Push the branch and open a PR against `main` like any other change.

## Release to Snowsight

Snowsight doesn't install this package from npm directly — it installs the public `@dropbox/ttvc` npm package in the `snapps` repo, patched via [`pnpm patch`](https://pnpm.io/cli/patch) with our fork's changes.

1. Make sure the fixes you want shipped are merged to `main`.
2. Fast-forward `snow-release` to `main`:

   ```
   git checkout snow-release
   git merge main
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
