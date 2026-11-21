---
id: PRD-0002
title: The whatwhy CLI package
status: approved
date: "2026-11-21"
---

# PRD-0002: The whatwhy CLI package

<!-- status: draft | approved | shipped | abandoned -->

## Problem

whatwhy enforces the PRD/ADR process with one script that only checks and
indexes. Everything else is done by hand: copying a template, picking the next
number, changing a status, superseding an ADR, adopting the template. Agents
do most of this work, and the manual steps are where they trip the structure
rule. A repository that was not created from the template has no supported way
in at all (deferred by PRD-0001).

## Goals

- Every step of the process is one command, so an agent never edits
  frontmatter, numbers or indexes by hand.
- Any repository, new or existing, adopts the process with one command and
  stays current with another.
- A cold session learns the state of the specs from one command instead of
  reading the indexes and documents.
- Hooks stay fast and offline: the repository keeps a self-contained,
  dependency-free script (ADR-0002). The npm package is only how it arrives.

## Non-goals

- A human gate in the CLI. Any caller may run status commands; pull request
  review and merge is the gate.
- An MCP server, agent skills or a packaged GitHub Action.
- A `trace` command linking specs to commits.
- Judging document quality.

## Requirements

Setup

1. `whatwhy init [--name <name>] [--description <text>]` scaffolds the docs
   directories, templates, `AGENTS.md`, config, hook and workflow into an empty
   or existing repository, and vendors the script. Generated files describe the
   target project, so nothing needs replacing afterwards. Existing files are
   never overwritten.
2. `whatwhy upgrade` refreshes the vendored script, the templates and the
   managed process section of `AGENTS.md` to the package version. It never
   changes a PRD, an ADR or the project section of `AGENTS.md`.
3. `whatwhy doctor` reports wiring problems: hook path, workflow, config
   validity, Node version and base branch. Each finding says how to fix it.

Authoring

4. `whatwhy new adr|prd "<title>" [--prd <ID>] [--supersedes <ID>]` creates
   the document from its template with the next number, a matching `id` and
   filename, and today's date, then reindexes. With `--supersedes`, it also
   sets the old ADR to `superseded` with `superseded-by` in the same change.
5. `whatwhy accept|reject|deprecate <ADR>` and
   `whatwhy approve|ship|abandon <PRD>` apply a status transition, then
   reindex. A transition the check would reject fails without writing.

Reading

6. `whatwhy status` prints a one-screen brief: open PRDs, accepted ADRs, and
   the specs the current branch references.
7. `whatwhy list [adr|prd] [--status <status>]` returns the index as data.
8. `whatwhy show <ID> [--section <name>]` prints the document for an ID, or
   one section of it.

Enforcing

9. `whatwhy check [--base <ref>] [--message-file <path>]` applies the four
   rules of PRD-0001 with the same findings and exit codes as today.
10. `whatwhy check --fix` repairs mechanical findings (stale index, `id` and
    filename mismatch, missing reciprocal supersede) and reports the rest.
11. `whatwhy index` regenerates the indexes.

Every command

12. `--json` is accepted everywhere. A mutation returns
    `{ data, changes[], warnings[] }`; a failure returns
    `{ code, message, retryable }` and a non-zero exit code.
13. No command prompts. Every input is a flag or argument.
14. Every mutating command accepts `--dry-run`, which reports `changes[]` and
    writes nothing.
15. Mutations are idempotent: repeating a command that already took effect
    succeeds with empty `changes[]`.
16. The vendored script uses the Node standard library only and runs without
    `npm install` or network access.

## Success criteria

- `npx whatwhy init` in an empty git repository, then one commit, ends with
  `whatwhy check` reporting 0 errors and nothing that describes whatwhy as the
  product.
- An agent can write, accept and supersede an ADR without opening a file under
  `docs/` except to write the document's prose.
- Each requirement has a test, including a run-twice test for every mutation.
- This repository uses the CLI for its own documents.

## Open decisions

Each needs an ADR before the code that depends on it:

1. What happens to the template repository and `ADOPT.md` once `init` exists.
2. How `upgrade` marks the managed section of `AGENTS.md`.
3. Source layout: one file, or modules bundled into the one vendored file.
