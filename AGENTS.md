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
- Code: `scripts/whatwhy.mjs`, one file (ADR-0008). Test with `npm test`.
- Every file is inherited by repositories made from the template. Keep
  whatwhy-specific wording to this section, `README.md`, `ADOPT.md` and
  PRD-0001.

<!-- whatwhy:begin (managed by `whatwhy upgrade`; edits between the markers are overwritten) -->

## Process: PRD → ADRs → code

`whatwhy` below means `node scripts/whatwhy.mjs`. Start with `whatwhy status`:
open PRDs, accepted ADRs, and the specs this branch references. Then read only
what the work needs, with `whatwhy list` and
`whatwhy show <ID> [--section <name>]`.

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

- `whatwhy new adr|prd "<title>"` creates it: next number, frontmatter, index.
  Link an ADR to its PRD with `--prd <ID>`. Then fill in every section. Over
  one page usually means two documents.
- **ADRs** start as `proposed`. When a human has decided, run
  `whatwhy accept <ID>` or `whatwhy reject <ID>`. Once merged, an accepted ADR
  is frozen: never edit or delete it. To change the decision, run
  `whatwhy new adr "<title>" --supersedes <ID>`. To retire it, run
  `whatwhy deprecate <ID>`.
- **PRDs** stay editable. `whatwhy approve|ship|abandon <ID>` moves the status.
- Never edit an `id`, a number, a `status` or an `INDEX.md` by hand.
- **Nothing else is stored.** Plans and progress notes belong in the issue or
  pull request.

## The check

`whatwhy check` runs on every pull request, and on every commit once the hook
is on. `whatwhy doctor` says whether it is, and what else is not wired up.

| Rule | Requires | Default |
| --- | --- | --- |
| `structure` | valid filenames, frontmatter and sections; contiguous numbers; references that resolve; fresh indexes | error |
| `immutability` | merged ADRs past `proposed` are not edited, deleted or renamed | error |
| `traceability` | the change references a PRD or ADR, or states `no-spec: <reason>` | warn |
| `architecture` | a change to `architecturalPaths` comes with an ADR, or states `no-adr: <reason>` | warn |

Each finding says how to fix it, and `whatwhy check --fix` repairs the
mechanical ones. Fix the cause or give the reason; never use `--no-verify`.
Severities and `architecturalPaths` are set in `whatwhy.config.json`.

Every command takes `--json` and returns `{ data, changes[], warnings[] }`, or
`{ code, message, retryable }` on failure. Commands that write take
`--dry-run`.

## Conventions

- Never commit to `main`. Branch, then open a pull request.
- This file stays under 100 lines. Detail belongs in a PRD or ADR.

<!-- whatwhy:end -->
