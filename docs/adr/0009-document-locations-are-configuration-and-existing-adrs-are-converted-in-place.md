---
id: ADR-0009
title: Document locations are configuration, and existing ADRs are converted in place
status: accepted
date: "2026-11-21"
prd: PRD-0003
---

# ADR-0009: Document locations are configuration, and existing ADRs are converted in place

## Context

whatwhy 0.1.0 fixes its folders at `docs/adr` and `docs/prd`. A repository
that already keeps ADRs somewhere else gets a second, empty folder from
`init`, and two places where ADR-0001 can exist (PRD-0003).

There are two ways to end with one system. Move the existing ADRs into
`docs/adr` and rewrite them from the template, or leave them where they are
and teach whatwhy to read that folder. Moving breaks every link and citation
to the old paths, and loses sections the template does not have. It also
means whatwhy rewrites decisions that were already made, which is what the
immutability rule exists to prevent.

Existing ADRs carry their metadata as lines in the body (`Status: accepted`,
`Date: 2026-10-26`) or in a `## Status` section. The check reads frontmatter,
so something has to change in each file.

## Decision

- The two folders are configuration: `directories.adr` and `directories.prd`
  in `whatwhy.config.json`, defaulting to `docs/adr` and `docs/prd`. `init`
  sets them with `--adr-dir` and `--prd-dir`.
- `init` refuses to run when it finds tracked ADRs in a folder it was not
  pointed at. The human chooses: adopt that folder, or keep it apart.
- `whatwhy import` converts existing ADRs where they sit. It adds frontmatter
  built from the filename, the first heading and the status and date lines,
  and removes those lines from the body. It changes nothing else: numbers,
  filenames, headings and extra sections stay.
- `import` converts only what it can read exactly. A file with no heading or
  an unrecognised status is skipped and reported, not guessed at.
- Sections and statuses are not configurable. An imported ADR must still have
  Context, Decision and Consequences, and may have more.

## Consequences

- Links and citations to existing ADRs keep working, and history stays with
  the files.
- Every place in the script that named `docs/adr` now reads the config, so a
  wrong value there breaks every command. The config is validated on load.
- Import is the one sanctioned edit to decisions that were already accepted.
  The immutability rule allows it without a special case, because a file with
  no frontmatter on the base branch is not yet a frozen ADR.
- Repositories whose ADRs use other section names, or numbers with gaps, will
  import and then fail the structure rule. They fix the documents by hand
  before merging the import, because after it the ADRs are frozen.
- Existing PRDs are not imported. A repository that wants them managed
  rewrites them from the template.
