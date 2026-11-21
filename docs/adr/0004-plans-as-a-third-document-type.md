---
id: ADR-0004
title: Plans as a third document type
status: rejected
date: "2026-11-21"
---

# ADR-0004: Plans as a third document type

## Context

Agents write implementation plans constantly: the steps, their order, and
progress so far. A PRD says what and why, an ADR records a decision, and
neither says how. Plans currently land in chat or in tool-specific
directories that the next session cannot see. A `docs/plans/` directory would
give them a tool-agnostic home.

## Decision

We will not add a plans directory or a plan document type.

Everything durable in a plan already has a home: scope is a PRD requirement,
and a choice is an ADR. What remains is sequencing and progress, which is
true for days. Stored beside the durable documents it becomes a second source
that can disagree with them, and a reader cannot tell which is current. Even
plans kept only after completion would restate the PRDs and ADRs.

Plans live with the work: in the issue, the pull request description, or the
agent's own tooling. If a plan contains something that must outlive the work,
move it into a PRD or an ADR.

## Consequences

- PRDs and ADRs stay the only source of truth in the repository.
- Handoff state for work that spans sessions depends on an issue tracker or
  pull request, which this template does not provide or check.
- Reconsider if repositories using the template keep losing work in progress
  between sessions. That would need a new ADR.
