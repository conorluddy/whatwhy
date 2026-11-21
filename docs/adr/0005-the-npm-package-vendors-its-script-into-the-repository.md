---
id: ADR-0005
title: The npm package vendors its script into the repository
status: accepted
date: "2026-11-21"
prd: PRD-0002
---

# ADR-0005: The npm package vendors its script into the repository

## Context

PRD-0002 turns the check script into a CLI published to npm as `whatwhy`. The
commit hook and the CI job have to keep working in a fresh clone, offline, in
repositories that are not Node projects and have no `node_modules`. Running the
CLI through `npx` on every commit would need the network and add seconds to
each one. A `devDependency` only works where there is a `package.json`.

## Decision

- `whatwhy init` copies the script to `scripts/whatwhy.mjs` in the target
  repository and commits to nothing else at runtime. The hook, the workflow
  and agents run that copy with `node scripts/whatwhy.mjs <command>`.
- `npx whatwhy upgrade` replaces the copy with the version in the package.
- The script carries its own version number.
- `init` and `upgrade` need files that only the package has. Run from a
  vendored copy, they say to use `npx whatwhy` instead of failing obscurely.

## Consequences

- ADR-0002 still holds: one dependency-free script, nothing to install.
- Every repository pins its own version by having the file. Upgrades are an
  explicit, reviewable diff.
- A fix in the package reaches a repository only when someone runs `upgrade`.
- The script can be edited locally. `upgrade` overwrites such edits.
