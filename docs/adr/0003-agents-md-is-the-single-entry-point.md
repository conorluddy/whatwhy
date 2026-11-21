---
id: ADR-0003
title: AGENTS.md is the single entry point for agents
status: accepted
date: "2026-11-21"
---

# ADR-0003: AGENTS.md is the single entry point for agents

## Context

Each agent tool reads its own instruction file (`CLAUDE.md`, `AGENTS.md`,
editor-specific rule files). Maintaining the same guidance in several files
guarantees they drift. `AGENTS.md` is the name most tools read or can be
pointed at.

## Decision

`AGENTS.md` at the repository root holds all agent guidance and stays under
100 lines. Tool-specific files contain only a pointer to it (`CLAUDE.md` is
one line: `@AGENTS.md`). Detail lives in the PRDs and ADRs, reached through
their indexes.

## Consequences

- There is one file to keep current.
- Tool-specific features (skills, hooks, commands) are optional adapters, not
  part of the core.
- The line limit forces guidance to link out to documents instead of growing.
