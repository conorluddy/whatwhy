// @ts-check
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { runChecks, writeIndexes } from './whatwhy.mjs'

const ADR_PATH = 'docs/adr/0001-use-sqlite.md'

// === STRUCTURE ===

test('a repository that follows the process has no findings', () => {
  const repository = createRepository()
  assert.deepEqual(repository.check(), [])
})

test('a gap in ADR numbering is an error', () => {
  const repository = createRepository()
  repository.write('docs/adr/0003-skip-a-number.md', adr({ id: 'ADR-0003' }))
  repository.reindex()
  assert.deepEqual(repository.codes('error'), ['numbering-not-contiguous'])
})

test('a document missing a required section is an error', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-no-consequences.md', adr({ id: 'ADR-0002' }).replace('## Consequences', '## Outcome'))
  repository.reindex()
  assert.deepEqual(repository.codes('error'), ['missing-section'])
})

test('an index that lags behind the documents is an error until regenerated', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-queues.md', adr({ id: 'ADR-0002' }))
  assert.deepEqual(repository.codes('error'), ['stale-index'])
  repository.reindex()
  assert.deepEqual(repository.codes('error'), [])
})

test('a reference to a document that does not exist is an error', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-queues.md', adr({ id: 'ADR-0002', extra: 'prd: PRD-0009' }))
  repository.reindex()
  assert.deepEqual(repository.codes('error'), ['unresolved-reference'])
})

// === IMMUTABILITY ===

test('editing the body of an accepted ADR is an error', () => {
  const repository = createRepository()
  repository.write(ADR_PATH, adr({ id: 'ADR-0001' }).replace('We will.', 'We will not.'))
  assert.deepEqual(repository.codes('error'), ['frozen-adr-edited'])
})

test('deleting an accepted ADR is an error', () => {
  const repository = createRepository()
  rmSync(join(repository.root, ADR_PATH))
  repository.reindex()
  assert.deepEqual(repository.codes('error'), ['frozen-adr-removed'])
})

test('an accepted ADR can be superseded by a new one', () => {
  const repository = createRepository()
  repository.write(ADR_PATH, adr({ id: 'ADR-0001', status: 'superseded', extra: 'superseded-by: ADR-0002' }))
  repository.write('docs/adr/0002-use-postgres.md', adr({ id: 'ADR-0002', extra: 'supersedes: ADR-0001' }))
  repository.reindex()
  assert.deepEqual(repository.check(), [])
})

test('superseding an ADR without marking the old one is an error', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-postgres.md', adr({ id: 'ADR-0002', extra: 'supersedes: ADR-0001' }))
  repository.reindex()
  assert.deepEqual(repository.codes('error'), ['supersede-not-reciprocal'])
})

test('an accepted ADR cannot go back to proposed', () => {
  const repository = createRepository()
  repository.write(ADR_PATH, adr({ id: 'ADR-0001', status: 'proposed' }))
  repository.reindex()
  assert.deepEqual(repository.codes('error'), ['invalid-status-transition'])
})

test('an ADR accepted on this branch stays editable until it is merged', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-queues.md', adr({ id: 'ADR-0002' }))
  repository.reindex()
  repository.commit('docs: add ADR-0002')
  repository.write('docs/adr/0002-use-queues.md', adr({ id: 'ADR-0002' }).replace('We will.', 'We will, after review.'))
  assert.deepEqual(repository.check(), [])
})

test('a proposed ADR can still be edited', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-maybe-queues.md', adr({ id: 'ADR-0002', status: 'proposed' }))
  repository.reindex()
  repository.commit('docs: propose ADR-0002')
  repository.write('docs/adr/0002-maybe-queues.md', adr({ id: 'ADR-0002', status: 'proposed' }).replace('We will.', 'We might.'))
  assert.deepEqual(repository.check(), [])
})

// === TRACEABILITY ===

test('a change that references no spec is a warning', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  assert.deepEqual(repository.codes('warn'), ['missing-spec-reference'])
  assert.deepEqual(repository.codes('error'), [])
})

test('a commit message that names a spec satisfies traceability', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  repository.commit('feat: add feature (PRD-0001)')
  assert.deepEqual(repository.check(), [])
})

test('the message of the commit in progress counts, without its comment lines', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  const messageFile = join(repository.root, '.git/COMMIT_EDITMSG')
  writeFileSync(messageFile, 'feat: add feature\n# On branch for ADR-0001\n')
  assert.deepEqual(repository.codes('warn', { messageFile }), ['missing-spec-reference'])
  writeFileSync(messageFile, 'feat: add feature\n\nImplements ADR-0001.\n')
  assert.deepEqual(repository.check({ messageFile }), [])
})

test('no-spec with a reason satisfies traceability', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  assert.deepEqual(repository.check({ pullRequestText: 'Fix typo\n\nno-spec: typo fix' }), [])
})

test('a reference to a spec that does not exist is a warning', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  assert.deepEqual(repository.codes('warn', { pullRequestText: 'Implements PRD-0042' }), ['unknown-spec-reference'])
})

// === ARCHITECTURE ===

test('changing an architectural path without an ADR is a warning', () => {
  const repository = createRepository()
  repository.write('services/api/package.json', '{}\n')
  assert.deepEqual(repository.codes('warn', { pullRequestText: 'PRD-0001' }), ['architectural-change-without-adr'])
})

test('an ADR in the same change, or no-adr with a reason, satisfies the architecture rule', () => {
  const repository = createRepository()
  repository.write('package.json', '{}\n')
  assert.deepEqual(repository.check({ pullRequestText: 'PRD-0001\nno-adr: script rename only' }), [])
  repository.write('docs/adr/0002-add-dependency.md', adr({ id: 'ADR-0002' }))
  repository.reindex()
  assert.deepEqual(repository.check(), [])
})

// === CONFIGURATION ===

test('a rule set to error in whatwhy.config.json blocks instead of warning', () => {
  const repository = createRepository()
  repository.write('whatwhy.config.json', JSON.stringify({ rules: { traceability: 'error' } }))
  assert.deepEqual(repository.codes('error'), ['missing-spec-reference'])
})

test('an unknown severity fails with a message naming the setting', () => {
  const repository = createRepository()
  repository.write('whatwhy.config.json', JSON.stringify({ rules: { traceability: 'loud' } }))
  assert.throws(() => repository.check(), /rules\.traceability is "loud"/)
})

// === FIXTURES ===

/** A committed repository on a feature branch with one PRD and one accepted ADR. */
function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'whatwhy-test-'))
  test.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (/** @type {string[]} */ ...gitArguments) =>
    execFileSync('git', ['-c', 'user.name=whatwhy', '-c', 'user.email=whatwhy@example.invalid', '-c', 'commit.gpgsign=false', ...gitArguments], { cwd: root, stdio: 'pipe' })

  const repository = {
    root,
    write(/** @type {string} */ path, /** @type {string} */ content) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    },
    reindex: () => writeIndexes(root),
    commit(/** @type {string} */ message) {
      git('add', '-A')
      git('commit', '-q', '-m', message)
    },
    check: (/** @type {import('./whatwhy.mjs').CheckOptions} */ options = {}) => runChecks(root, options),
    codes: (/** @type {'error' | 'warn'} */ severity, /** @type {import('./whatwhy.mjs').CheckOptions} */ options = {}) =>
      runChecks(root, options).filter((finding) => finding.severity === severity).map((finding) => finding.code),
  }

  repository.write('whatwhy.config.json', JSON.stringify({ architecturalPaths: ['**/package.json'] }))
  repository.write('docs/prd/0001-first-product.md', prd())
  repository.write(ADR_PATH, adr({ id: 'ADR-0001' }))
  repository.reindex()
  git('init', '-q', '-b', 'main')
  repository.commit('chore: initial commit')
  git('checkout', '-q', '-b', 'feature/work')
  assert.match(readFileSync(join(root, 'docs/adr/INDEX.md'), 'utf8'), /ADR-0001/)
  return repository
}

function adr({ id = 'ADR-0001', status = 'accepted', extra = '' }) {
  return `---\nid: ${id}\ntitle: A decision\nstatus: ${status}\ndate: "2026-01-01"\n${extra ? `${extra}\n` : ''}---\n\n## Context\n\nWhy.\n\n## Decision\n\nWe will.\n\n## Consequences\n\nThen.\n`
}

function prd() {
  return `---\nid: PRD-0001\ntitle: A product\nstatus: approved\ndate: "2026-01-01"\n---\n\n## Problem\n\n## Goals\n\n## Non-goals\n\n## Requirements\n\n## Success criteria\n`
}
