# whatwhy

**PRDs say what, ADRs say why.** A template for repositories that agents work
in. It sets up a formal product development process (PRDs and ADRs) and
enforces it with one dependency-free script.

Agents decide as they go, and the reasons vanish with the session. whatwhy
makes the reasons a precondition of the commit.

## Use it

1. Create a repository from this template and clone it.
2. Open it with your coding agent and ask it to adopt the template. It reads
   `AGENTS.md`, finds [ADOPT.md](ADOPT.md), asks what you are building, and
   rewrites the files that describe whatwhy (including this README) to describe
   your product. You can also follow `ADOPT.md` by hand.

Requires Node 20 or later and git. Nothing to install.

## What your repository inherits

| File | After adoption |
| --- | --- |
| `AGENTS.md` | the process, for any agent; you rewrite one section about your project |
| `CLAUDE.md` | one line pointing at `AGENTS.md` |
| `docs/prd/` | product requirements: numbered, templated, indexed; you write PRD-0001 |
| `docs/adr/` | architecture decisions: numbered, templated, indexed, frozen once merged; starts with the four that define this process |
| `scripts/whatwhy.mjs` | the enforcement and its tests |
| `whatwhy.config.json` | rule severities and the paths that count as architectural |
| `.githooks/commit-msg` | runs the check on every commit |
| `.github/` | runs the check on every pull request; pull request template |
| `README.md`, `ADOPT.md` | replaced and deleted |

## The rules

| Rule | Default | What it stops |
| --- | --- | --- |
| `structure` | error | malformed, misnumbered or unindexed documents |
| `immutability` | error | rewriting a merged decision instead of superseding it |
| `traceability` | warn | changes that reference no PRD or ADR and give no reason |
| `architecture` | warn | architectural changes with no ADR and no reason |

The first two are mechanical, so they block. The last two depend on judgment
about scope, so they warn and offer an escape hatch (`no-spec: <reason>`,
`no-adr: <reason>`). Set any rule to `error`, `warn` or `off` in
`whatwhy.config.json`.

The script does not judge whether a document is any good. That stays with you.

## Why it is built this way

whatwhy is built with its own process, so the reasoning is in its documents:

- [PRD-0001](docs/prd/0001-whatwhy-boilerplate.md): what whatwhy is and is not
- [ADR-0001](docs/adr/0001-prds-and-adrs-are-the-only-required-documents.md): two document types and nothing else
- [ADR-0002](docs/adr/0002-one-dependency-free-node-script-enforces-the-process.md): one Node script, errors versus warnings
- [ADR-0003](docs/adr/0003-agents-md-is-the-single-entry-point.md): `AGENTS.md` as the single entry point
- [ADR-0004](docs/adr/0004-plans-as-a-third-document-type.md): why there is no plans directory (rejected)

To work on whatwhy itself, read [AGENTS.md](AGENTS.md).
