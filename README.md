# whatwhy

**PRDs say what, ADRs say why.** A formal product development process for
repositories that agents work in, enforced by one dependency-free script.

Agents decide as they go, and the reasons vanish with the session. whatwhy
makes the reasons a precondition of the commit, and gives agents one command
for every step so they never number, index or restatus a document by hand.

## Use it

In any git repository, new or existing:

```sh
npx whatwhy init --name "Acme" --description "Invoicing for freelancers."
```

This copies the script to `scripts/whatwhy.mjs`, adds the process to
`AGENTS.md`, and sets up the templates, config, commit hook and pull request
workflow. Files you already have are left alone. From then on the repository
runs its own copy, offline:

```sh
node scripts/whatwhy.mjs status
```

`npx whatwhy upgrade` brings the script and the process section of `AGENTS.md`
up to the latest version. It leaves each `TEMPLATE.md` alone, so add your own
sections there. Requires Node 20 or later and git. Nothing is installed.

Already keeping ADRs? Point whatwhy at them and convert them where they are:

```sh
npx whatwhy init --adr-dir docs/decisions
node scripts/whatwhy.mjs import
```

`import` gives each ADR frontmatter from its filename, heading and `Status:`
and `Date:` lines. Numbers, filenames and extra sections stay as they are, and
a file it cannot read exactly is skipped with the reason. Plain `init` stops
if it finds ADRs in a folder it was not pointed at, so you never end up with
two sets.

Starting from nothing? You can also create a repository from this template,
which brings the ADRs that explain the process, and follow
[ADOPT.md](ADOPT.md).

## Commands

| Command | Does |
| --- | --- |
| `init`, `upgrade`, `doctor` | set up, refresh, and report what is not wired up. `init --adr-dir <path> --prd-dir <path>` puts the documents somewhere other than `docs/adr` and `docs/prd` |
| `import` | converts ADRs written before whatwhy, in place |
| `new adr\|prd "<title>"` | creates the next document: number, frontmatter, index. `--prd <ID>` links an ADR to its PRD; `--supersedes <ID>` also marks the old ADR |
| `accept\|reject\|deprecate <ADR>` | moves an ADR to a new status |
| `approve\|ship\|abandon <PRD>` | moves a PRD to a new status |
| `status` | open PRDs, accepted ADRs, and the specs the current branch references |
| `list [adr\|prd] [--status <status>]` | the index as data |
| `show <ID> [--section <name>]` | a document, or one section of it |
| `check [--fix] [--errors-only]` | applies the rules; `--fix` repairs the mechanical findings; `--errors-only` leaves out warnings |
| `index` | regenerates the indexes |

Built for agents: every command takes `--json` and returns
`{ data, changes[], warnings[] }`, or `{ code, message, retryable }` on
failure. Nothing prompts. Commands that write take `--dry-run`, and running
one twice changes nothing the second time.

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
`whatwhy.config.json`. The commit hook prints errors only; warnings show on
the pull request and when you run `check` yourself.

The script does not judge whether a document is any good. That stays with you.

## Why it is built this way

whatwhy is built with its own process, so the reasoning is in its documents.
Run `node scripts/whatwhy.mjs list`, or start with:

- [PRD-0001](docs/prd/0001-whatwhy-boilerplate.md),
  [PRD-0002](docs/prd/0002-whatwhy-cli.md) and
  [PRD-0003](docs/prd/0003-adopting-whatwhy-where-adrs-already-exist.md):
  what whatwhy is and is not
- [ADR-0001](docs/adr/0001-prds-and-adrs-are-the-only-required-documents.md): two document types and nothing else
- [ADR-0002](docs/adr/0002-one-dependency-free-node-script-enforces-the-process.md): one Node script, errors versus warnings
- [ADR-0005](docs/adr/0005-the-npm-package-vendors-its-script-into-the-repository.md): why the script is copied into your repository
- [ADR-0009](docs/adr/0009-document-locations-are-configuration-and-existing-adrs-are-converted-in-place.md): why existing ADRs are converted where they sit

To work on whatwhy itself, read [AGENTS.md](AGENTS.md).
