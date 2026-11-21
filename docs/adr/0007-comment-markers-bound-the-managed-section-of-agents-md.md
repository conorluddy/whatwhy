---
id: ADR-0007
title: Comment markers bound the managed section of AGENTS.md
status: accepted
date: "2026-11-21"
prd: PRD-0002
---

# ADR-0007: Comment markers bound the managed section of AGENTS.md

## Context

`AGENTS.md` holds two kinds of text (ADR-0003): a section about the project,
written by its owners, and the process, which is the same in every repository
and changes with the package. `whatwhy upgrade` has to replace the second
without touching the first. Finding the boundary by heading breaks when a
heading is renamed or a section is added below. Moving the process to its own
file would undo ADR-0003.

## Decision

The process text sits between two HTML comments, `<!-- whatwhy:begin -->` and
`<!-- whatwhy:end -->`. `upgrade` replaces everything between them and nothing
outside. `init` writes the markers into a new `AGENTS.md`, and appends a
marked section to an existing one that has none. If the markers are missing or
out of order, `upgrade` changes nothing in the file and says so.

## Consequences

- Text outside the markers belongs to the repository and survives upgrades.
- Edits between the markers are overwritten. The opening marker says so.
- The markers are invisible when rendered and count towards the 100-line
  limit.
- Deleting a marker silently opts the file out of upgrades; `doctor` reports
  it.
