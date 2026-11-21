---
id: ADR-0008
title: The CLI stays one file, with scaffolding in a templates directory
status: accepted
date: "2026-11-21"
prd: PRD-0002
---

# ADR-0008: The CLI stays one file, with scaffolding in a templates directory

## Context

The CLI in PRD-0002 takes the script from about 400 lines to well over 1,000.
ADR-0005 vendors it into every repository, and ADR-0002 requires it to run
with no build step and no dependencies. Splitting it into modules means either
vendoring a directory or maintaining a bundler written with the standard
library.

## Decision

- All commands live in `scripts/whatwhy.mjs`, organised by section comments.
  The file that is edited is the file that ships.
- The files `init` and `upgrade` write (the `AGENTS.md` skeleton, the document
  templates, the default config, the hook, the workflow, the pull request
  template) live in `templates/` in the package, as real files and not as
  strings in the script.
- A test fails if this repository's own copies drift from `templates/`.

## Consequences

- No build step, and nothing between source and shipped file to debug.
- The script is far past the size where a file is easy to hold in mind.
  Section comments and a command table at the top have to carry navigation.
- `init` and `upgrade` only work from the package, where `templates/` exists
  (ADR-0005).
- If the file becomes unworkable, bundling is the way out and needs a new ADR.
