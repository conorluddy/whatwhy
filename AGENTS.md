# AGENTS.md

> **`ADOPT.md` exists?** This repository was created from the whatwhy template
> and still describes whatwhy. Follow `ADOPT.md` first. (Not in the whatwhy
> template repository itself. Ask the human if you cannot tell which this is.)

## This project

<!-- Rewrite this section when adopting the template. Keep it under 15 lines. -->

**whatwhy** (PRDs say what, ADRs say why) is a template for repositories that
agents work in. Its product is the process below and the script that enforces
it.

- Stack: Node 20+, standard library only (ADR-0002).
- Code: `scripts/whatwhy.mjs`. Test with `npm test`.
- Every file is inherited by repositories made from the template. Keep
  whatwhy-specific wording to this section, `README.md`, `ADOPT.md` and
  PRD-0001.

## Process: PRD → ADRs → code

Start at the indexes and open only the documents the work needs.

- [docs/prd/INDEX.md](docs/prd/INDEX.md): what is being built and why
- [docs/adr/INDEX.md](docs/adr/INDEX.md): decisions already made

Before writing code, work out which case applies:

| The work | Do first |
| --- | --- |
| is covered by a PRD or ADR | reference its ID |
| adds user-visible capability that no PRD covers | write a PRD |
| makes a choice that is expensive to reverse (a dependency, data model, protocol, build or deploy mechanism) | write an ADR |
| is none of these (a bug fix, a typo, a refactor within an existing decision) | state `no-spec: <reason>` |

The ID or reason goes in the branch name (`feature/prd-0001-user-accounts`), a
commit message (`feat: add sign-up form (PRD-0001)`) or the pull request.

Unsure whether a document is needed? Ask the human. Never write one only to
satisfy the check.

## Writing a document

1. Copy `docs/<adr|prd>/TEMPLATE.md` to `NNNN-kebab-case-title.md` with the
   next unused number, and set `id` to match.
2. Fill in every section. Over one page usually means two documents.
3. Run `npm run whatwhy:index`.

- **ADRs** start as `proposed`; a human accepts them. Once merged, an accepted
  ADR is frozen: never edit or delete it. To change the decision, write a new
  ADR with `supersedes: ADR-NNNN` and set the old one to `status: superseded`
  and `superseded-by: ADR-MMMM`.
- **PRDs** stay editable.
- **Nothing else is stored.** Plans and progress notes belong in the issue or
  pull request (ADR-0004).

## The check

`npm run whatwhy:check` runs on every pull request, and on every commit once
`npm run setup` has been run in the clone. Add `-- --json` for
`{ ok, findings[] }`.

| Rule | Requires | Default |
| --- | --- | --- |
| `structure` | valid filenames, frontmatter and sections; contiguous numbers; references that resolve; fresh indexes | error |
| `immutability` | merged ADRs past `proposed` are not edited, deleted or renamed | error |
| `traceability` | the change references a PRD or ADR, or states `no-spec: <reason>` | warn |
| `architecture` | a change to `architecturalPaths` comes with an ADR, or states `no-adr: <reason>` | warn |

Each finding says how to fix it. Fix the cause or give the reason; never use
`--no-verify`. Severities and `architecturalPaths` are set in
[whatwhy.config.json](whatwhy.config.json).

## Conventions

- Never commit to `main`. Branch, then open a pull request.
- This file stays under 100 lines (ADR-0003). Detail belongs in a PRD or ADR.
