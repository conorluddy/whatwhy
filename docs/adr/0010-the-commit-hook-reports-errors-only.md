---
id: ADR-0010
title: The commit hook reports errors only
status: accepted
date: "2026-11-21"
prd: PRD-0003
---

# ADR-0010: The commit hook reports errors only

## Context

The commit hook runs `whatwhy check` on every commit. The traceability and
architecture rules warn by default (ADR-0002), because they depend on judgment
about scope. On a branch that carries its reference in the pull request, or in
a commit not yet written, the hook prints the same warning on every commit and
then lets the commit through. Output that never blocks is output people stop
reading, and the errors are printed in the same place.

Warnings are judged per change, not per commit. The pull request is where the
whole change, its title and its description are visible together.

## Decision

- `whatwhy check --errors-only` leaves out findings whose severity is `warn`.
- The commit hook that `init` installs passes `--errors-only`. If the hook
  prints a finding, the commit was blocked.
- The pull request workflow and `whatwhy check` run by hand still report
  warnings.
- Severity stays in the config. A repository that sets `traceability` or
  `architecture` to `error` gets it enforced on every commit as before.

## Consequences

- A commit is quiet unless it is blocked.
- A missing reference is first seen on the pull request, later than before.
  Agents that want it earlier run `whatwhy check` before pushing.
- `upgrade` does not rewrite an existing hook, because the hook belongs to the
  repository (PRD-0002). Repositories set up with 0.1.0 keep printing warnings
  until `--errors-only` is added to their hook by hand.
