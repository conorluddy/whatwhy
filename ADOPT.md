# Adopting the whatwhy template

First-time setup for a repository created from the whatwhy template. (To add
whatwhy to a repository that already exists, run `npx whatwhy init` instead.) An agent can do this
with the human, or a human can do it by hand in about ten minutes. When it is
done, this file is gone and the repository describes your product instead of
whatwhy.

Work on a branch (`chore/adopt-whatwhy`), not on `main`.

## 1. Ask before writing

Get these from the human. Do not invent them.

- What is the product, and who is it for?
- What is in the first version, and what is deliberately out?
- What is the stack? Which files, when changed, mean an architectural decision
  (dependency manifests, schemas, migrations, infrastructure, CI)?

## 2. Replace what is specific to whatwhy

| File | Do |
| --- | --- |
| `docs/prd/0001-whatwhy-boilerplate.md` | Replace with your product's PRD: keep the number, rename the file to `0001-<title>.md`, and rewrite it from `docs/prd/TEMPLATE.md` with status `draft` until the human approves it. |
| `AGENTS.md` | Rewrite the "This project" section. Delete the notice at the top about `ADOPT.md`. |
| `README.md` | Replace with your project's README. |
| `LICENSE` | Replace with your project's licence, or delete it. It covers whatwhy, not your code. |
| `package.json` | Set `name`, `description` and `version`. Remove `repository`, `license`, `bin`, `files` and the `test` script; keep `setup`. If the project is not a Node project, delete the file. |
| `templates/`, `scripts/whatwhy.test.mjs`, `.github/workflows/test.yml` | Delete. They belong to the whatwhy package. `npx whatwhy upgrade` brings later versions of the script. |
| `whatwhy.config.json` | Set `architecturalPaths` for your stack. |
| `ADOPT.md` | Delete, last. |

## 3. Keep what is the process

| File | Why |
| --- | --- |
| `docs/adr/0001` to `0008`, `docs/prd/0002-whatwhy-cli.md` | They record the process and the tool you have inherited. The ADRs are frozen; your first decision is ADR-0009. If you disagree with one, supersede it. |
| `scripts/whatwhy.mjs`, `.githooks/`, the rest of `.github/` | The enforcement. |
| `docs/*/TEMPLATE.md`, `CLAUDE.md` | Used as they are. |
| The rest of `AGENTS.md` | The process, written for any project. |

## 4. Finish

```sh
node scripts/whatwhy.mjs init      # enable the git hook in this clone
node scripts/whatwhy.mjs index     # regenerate the indexes for your PRD
node scripts/whatwhy.mjs check     # expect 0 errors
node scripts/whatwhy.mjs doctor    # expect no problems
```

Commit and open a pull request. The commit touches `package.json` and
`whatwhy.config.json`, which are architectural paths, so say why no ADR is
needed:

```
chore: adopt the whatwhy template (PRD-0001)

no-adr: first-time setup of the template, no new decision
```
