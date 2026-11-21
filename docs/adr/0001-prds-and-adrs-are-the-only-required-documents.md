---
id: ADR-0001
title: PRDs and ADRs are the only required documents
status: accepted
date: "2026-11-21"
---

# ADR-0001: PRDs and ADRs are the only required documents

## Context

Agents need two things written down before they write code: what is being
built and why (product intent), and which expensive-to-reverse choices have
already been made (architecture). Everything else can be recovered from the
code and the git history.

Every extra document type is another thing to keep current and another thing
an agent must load. Process that costs more than it saves gets bypassed.

## Decision

A repository has exactly two required document types:

- **PRD** (`docs/prd/`): written when adding user-visible capability. Living
  until shipped.
- **ADR** (`docs/adr/`): written when a decision is expensive to reverse.
  Frozen once merged with a status other than `proposed`; changed only by a
  superseding ADR.

Work flows PRD → ADRs → code. Changes reference the document that justifies
them by ID (`PRD-0001`, `ADR-0001`). Small changes that need no document say
so with `no-spec: <reason>`.

Documents are numbered markdown files with frontmatter, and each directory has
a generated `INDEX.md` so a reader can load summaries before full documents.

## Consequences

- An agent starting cold reads `AGENTS.md`, then two indexes, and knows the
  state of the product and its architecture.
- There is no home for roadmaps, RFCs or meeting notes. Repositories that need
  them add them outside this process.
- The bar for "needs a document" is a judgment call. The escape hatch keeps
  that judgment visible instead of forcing ceremony onto a typo fix.
