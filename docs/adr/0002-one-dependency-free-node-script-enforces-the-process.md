---
id: ADR-0002
title: One dependency-free Node script enforces the process
status: accepted
date: "2026-11-21"
---

# ADR-0002: One dependency-free Node script enforces the process

## Context

The process in ADR-0001 only holds if something checks it. The check has to
run in a fresh clone, in a git hook and in CI, for any project regardless of
its stack. POSIX shell has no dependencies but is poor at parsing frontmatter.
Node is present on nearly every development machine and CI image.

Some rules are mechanical (is the numbering contiguous?). Others depend on
judgment about scope (does this change need a document?). Blocking on the
second kind produces resentment and fake compliance.

## Decision

- All enforcement lives in `scripts/whatwhy.mjs`: one file, Node standard
  library only, plain JavaScript with JSDoc types so it runs without a build
  step on any supported Node version.
- It runs from a `commit-msg` git hook (which sees both the staged change and
  the commit message) and from a GitHub Actions workflow on pull requests.
- Rules about document structure and ADR immutability are errors. Rules about
  traceability and architectural paths are warnings.
- Severities and architectural paths are set in `whatwhy.config.json`.
- Findings have a stable `code` and are available as JSON with `--json`.
- The script only enforces what it can verify. Document quality stays guidance.

## Consequences

- A template user runs `npm run setup` once; there is nothing to install.
- Frontmatter is limited to flat `key: value` pairs, because the script carries
  its own parser.
- Warnings can be ignored. A repository that wants them enforced changes one
  line of configuration.
- Local hooks can be skipped with `--no-verify`; CI is the backstop.
