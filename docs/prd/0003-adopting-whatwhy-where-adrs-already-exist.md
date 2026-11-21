---
id: PRD-0003
title: Adopting whatwhy where ADRs already exist
status: approved
date: "2026-11-21"
---

# PRD-0003: Adopting whatwhy where ADRs already exist

<!-- status: draft | approved | shipped | abandoned -->

## Problem

`whatwhy init` assumes a repository with no decision records. Run in a
repository that already kept 14 ADRs in its own folder, version 0.1.0 created
an empty `docs/adr/` beside them. The repository then had two decision
systems, a number collision waiting at ADR-0001, and an `AGENTS.md` that
pointed at both. Repositories with a history of decisions are the ones with
the most to gain from enforcement, and they are the ones whatwhy handles
worst.

Two smaller problems showed up in the same adoption. The commit hook printed
traceability warnings on every commit, which taught people to ignore its
output. And the process section that `init` appends to an existing `AGENTS.md`
claimed the whole file stays under 100 lines, which is not whatwhy's to
promise about a file it does not own.

## Goals

- A repository that already has ADRs adopts whatwhy without moving,
  renumbering or rewriting them, and ends with one decision system.
- `init` never creates a second decisions folder by accident.
- What the commit hook prints is always something that blocks the commit.
- The process section says nothing about the parts of `AGENTS.md` it does not
  manage.

## Non-goals

- Importing existing PRDs. They stay unmanaged.
- Configurable section names or statuses.
- A configurable start number for ADRs.
- Trimming the process section of `AGENTS.md`.

## Requirements

Locations

1. `whatwhy.config.json` takes `directories.adr` and `directories.prd`,
   defaulting to `docs/adr` and `docs/prd`. Every command reads and writes
   documents, templates and indexes there. A value that is not a relative
   path inside the repository, or the same folder for both, fails with
   `invalid-configuration`.
2. `whatwhy init --adr-dir <path> --prd-dir <path>` writes those locations
   into a new config. When the config already exists, the flags are not used
   and a warning says so.
3. When there is no config and tracked files show ADRs in a folder other than
   the one `init` would use, `init` fails with `existing-decisions-found` and
   writes nothing. The message names the folder and gives both ways forward:
   adopt it with `--adr-dir`, or keep it apart by naming another folder.
4. A `README.md` in a document folder is not treated as a document.

Import

5. `whatwhy import` converts each ADR in the ADR folder that has no
   frontmatter, in place. The number comes from the filename, the title from
   the first heading, and the status and date from `Status:` and `Date:`
   lines or a `## Status` section. `superseded by NNNN` becomes
   `status: superseded` with `superseded-by`. Those lines move to frontmatter;
   the heading and every section stay as written.
6. An ADR with no date takes the date of the commit that added the file.
7. An ADR that cannot be converted (no heading, a missing or unknown status)
   is left untouched and reported with the reason. Nothing is guessed.
8. `import` reindexes, takes `--dry-run`, and changes nothing when run again.
   It returns `{ data: { imported[], skipped[] }, changes[], warnings[] }`.
9. The `invalid-frontmatter` finding on an ADR suggests `whatwhy import`.

References

10. `ADR 0006` and `PRD 0001`, with a space, count as references the same as
    `ADR-0006`, for traceability and for `status`.

Hook and process text

11. `whatwhy check --errors-only` leaves out findings whose severity is
    `warn`. The commit hook that `init` installs passes it. A rule set to
    `error` in the config still blocks the commit.
12. The process section of `AGENTS.md` makes no claim about the length of the
    file.

## Success criteria

- In a copy of the repository that prompted this, `init --adr-dir <its
  folder>`, then `import`, then `check` ends with all 14 ADRs imported under
  their original numbers and 0 errors.
- Plain `init` in that copy fails with `existing-decisions-found` and leaves
  the working tree clean.
- Each requirement has a test, including `--dry-run` and run-twice tests for
  `import` and the new `init` flags.

## Decisions

- ADR-0009: document locations are configuration, and existing ADRs are
  converted in place.
- ADR-0010: the commit hook reports errors only.
