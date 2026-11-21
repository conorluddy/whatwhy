---
id: ADR-0006
title: The template repository stays alongside init
status: accepted
date: "2026-11-21"
prd: PRD-0002
---

# ADR-0006: The template repository stays alongside init

## Context

Until PRD-0002 the only way to adopt the process was to create a repository
from the GitHub template and follow `ADOPT.md` (PRD-0001, requirement 11).
`whatwhy init` adds a second way that also works for existing repositories.
Retiring the template would leave one path to maintain. Keeping it preserves
the one-click start and the four ADRs that explain the process, which `init`
does not copy.

## Decision

Keep both. The repository remains a GitHub template with `ADOPT.md`, and is
also the source of the npm package. `ADOPT.md` lists the files that exist only
for the package (`templates/`, the test file, the test workflow, the `bin` and
`files` entries in `package.json`) as things to delete on adoption.

## Consequences

- Two adoption paths have to stay in step. A repository adopted either way
  must pass `check` and be upgradable with `npx whatwhy upgrade`.
- A repository created from the template starts with ADR-0001 to ADR-0008. One
  created by `init` starts with none, so the managed section of `AGENTS.md`
  cannot cite ADR numbers.
- `ADOPT.md` grows by the package-only files.
