---
id: PRD-0001
title: whatwhy, a boilerplate for agentic repositories
status: approved
date: "2026-11-21"
---

# PRD-0001: whatwhy, a boilerplate for agentic repositories

## Problem

Coding agents start work immediately and decide as they go. Product intent and
architectural decisions end up scattered across chat transcripts that the next
session cannot read. The result is rework, contradictory decisions, and code
whose "why" nobody can recover.

Templates alone do not fix this. An agent will ignore a `docs/adr/` folder
unless something stops the commit.

## Goals

- A new repository starts with a working product development process:
  PRD → ADRs → code.
- The process is enforced by a script, not by goodwill.
- It works with any agent or editor: plain markdown, git and Node.
- The whole process can be read and understood in under five minutes.

## Non-goals

- Judging document quality. A script cannot tell whether a PRD is good.
- Roadmaps, RFCs, epics, label taxonomies or issue tracking.
- An installer for retrofitting existing repositories (a later PRD).
- Tool-specific adapters such as agent skills (a later PRD).

## Requirements

1. `AGENTS.md` is the entry point and states the process in under 100 lines.
2. `docs/prd/` and `docs/adr/` each hold numbered documents, a `TEMPLATE.md`
   and a generated `INDEX.md`.
3. One check script validates the rules below, locally from a git hook and in
   CI from a workflow, with no installed dependencies.
4. Structure rule (blocks): filenames, frontmatter, required sections,
   contiguous numbering, resolvable cross-references, fresh indexes.
5. Immutability rule (blocks): an ADR that has left `proposed` and been merged
   to the base branch cannot be edited; it can only be superseded or
   deprecated. It stays editable during review of the change that adds it.
6. Traceability rule (warns): every change set references a PRD or ADR ID, or
   gives a reason with `no-spec:`.
7. Architecture rule (warns): a change to a declared architectural path comes
   with an ADR, or gives a reason with `no-adr:`.
8. Each rule's severity is configurable so a repository can tighten or relax it.
9. Findings are available as JSON so agents can act on them.
10. whatwhy is built with its own process and passes its own checks.
11. A repository created from the template is told, by `AGENTS.md` and an
    `ADOPT.md` checklist, which files to replace and which to keep. Wording
    specific to whatwhy is confined to the files that adoption replaces.

## Success criteria

- `node scripts/whatwhy.mjs check` passes on this repository.
- Each rule has a test that shows it firing and a test that shows it passing.
- A repository created from the template needs one command (`npm run setup`)
  before the rules apply to every commit.
- Following `ADOPT.md` in a fresh copy ends with `node scripts/whatwhy.mjs check`
  passing and nothing left that describes whatwhy as the product.
