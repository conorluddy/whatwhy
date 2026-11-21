// @ts-check
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CommandError, VERSION, runChecks, runCommand, writeIndexes } from './whatwhy.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT_PATH = join(PACKAGE_ROOT, 'scripts/whatwhy.mjs')
const ADR_PATH = 'docs/adr/0001-use-sqlite.md'
const PRD_PATH = 'docs/prd/0001-first-product.md'

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

// === AUTHORING ===

test('new adr creates the next numbered document, indexed and passing the check', () => {
  const repository = createRepository()
  const { data, changes } = repository.run('new', 'adr', 'Use queues: for "slow" work', '--prd', 'prd-1')
  const path = 'docs/adr/0002-use-queues-for-slow-work.md'
  assert.deepEqual(changes.map((change) => `${change.action} ${change.path}`), [`create ${path}`, 'update docs/adr/INDEX.md'])
  assert.deepEqual(data, { id: 'ADR-0002', kind: 'adr', title: 'Use queues: for "slow" work', status: 'proposed', date: localDate(), path, prd: 'PRD-0001' })
  assert.match(repository.read(path), /^# ADR-0002: Use queues: for "slow" work$/m)
  assert.deepEqual(repository.check(), [])
})

test('new adr without --prd leaves no placeholder reference behind', () => {
  const repository = createRepository()
  repository.run('new', 'adr', 'Use queues')
  assert.doesNotMatch(repository.read('docs/adr/0002-use-queues.md'), /NNNN|^prd:/m)
  assert.deepEqual(repository.codes('error'), [])
})

test('new prd creates a draft PRD', () => {
  const repository = createRepository()
  const { data } = repository.run('new', 'prd', 'Team accounts')
  assert.equal(data.id, 'PRD-0002')
  assert.equal(data.status, 'draft')
  assert.deepEqual(repository.check(), [])
})

test('new --supersedes marks the old ADR in the same change', () => {
  const repository = createRepository()
  const { changes } = repository.run('new', 'adr', 'Use Postgres', '--supersedes', 'ADR-0001')
  assert.deepEqual(changes.map((change) => change.path), ['docs/adr/0002-use-postgres.md', ADR_PATH, 'docs/adr/INDEX.md'])
  assert.match(repository.read(ADR_PATH), /^status: superseded\nsuperseded-by: ADR-0002$|^status: superseded$[\s\S]*^superseded-by: ADR-0002$/m)
  assert.deepEqual(repository.check(), [])
})

test('new refuses to supersede an ADR that is not accepted, and writes nothing', () => {
  const repository = createRepository()
  repository.write(ADR_PATH, adr({ status: 'proposed' }))
  repository.reindex()
  assert.equal(repository.failure('new', 'adr', 'Use Postgres', '--supersedes', 'ADR-0001').code, 'invalid-transition')
  assert.equal(existsSync(join(repository.root, 'docs/adr/0002-use-postgres.md')), false)
})

test('new fails on a PRD that does not exist', () => {
  const repository = createRepository()
  assert.equal(repository.failure('new', 'adr', 'Use queues', '--prd', 'PRD-0009').code, 'unknown-document')
})

test('accept, reject and deprecate move an ADR and refresh the index', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-queues.md', adr({ id: 'ADR-0002', status: 'proposed' }))
  repository.write('docs/adr/0003-use-graphql.md', adr({ id: 'ADR-0003', status: 'proposed' }))
  repository.reindex()
  assert.deepEqual(repository.run('accept', 'ADR-0002').data.to, 'accepted')
  assert.deepEqual(repository.run('reject', 'adr-3').data.to, 'rejected')
  assert.deepEqual(repository.run('deprecate', 'ADR-0001').data.to, 'deprecated')
  assert.deepEqual(repository.run('list', 'adr').data.map((/** @type {{ status: string }} */ each) => each.status), ['deprecated', 'accepted', 'rejected'])
  assert.deepEqual(repository.check(), [])
})

test('approve, ship and abandon move a PRD', () => {
  const repository = createRepository()
  repository.run('new', 'prd', 'Team accounts')
  repository.run('new', 'prd', 'Billing')
  assert.equal(repository.run('approve', 'PRD-0002').data.to, 'approved')
  assert.equal(repository.run('ship', 'PRD-0002').data.to, 'shipped')
  assert.equal(repository.run('abandon', 'PRD-0003').data.to, 'abandoned')
  assert.deepEqual(repository.codes('error'), [])
})

test('a transition the check would reject fails without writing', () => {
  const repository = createRepository()
  const before = repository.read(ADR_PATH)
  const failure = repository.failure('reject', 'ADR-0001')
  assert.equal(failure.code, 'invalid-transition')
  assert.match(failure.message, /ADR-0001 is accepted.*--supersedes ADR-0001/)
  assert.equal(repository.read(ADR_PATH), before)
})

test('a status command for the wrong kind of document names the right ones', () => {
  const repository = createRepository()
  const failure = repository.failure('accept', 'PRD-0001')
  assert.equal(failure.code, 'invalid-arguments')
  assert.match(failure.message, /for a PRD use approve, ship, abandon/)
})

// === READING ===

test('status lists open PRDs, accepted ADRs and the specs the branch references', () => {
  const repository = createRepository()
  repository.write('notes.txt', 'x')
  repository.commit('feat: something (ADR-0001, PRD-0007)')
  const { data, lines } = repository.run('status')
  assert.equal(data.branch, 'feature/work')
  assert.deepEqual(data.openPrds.map((/** @type {{ id: string }} */ each) => each.id), ['PRD-0001'])
  assert.deepEqual(data.acceptedAdrs.map((/** @type {{ id: string }} */ each) => each.id), ['ADR-0001'])
  assert.deepEqual(data.referenced.map((/** @type {{ id: string }} */ each) => each.id), ['ADR-0001'])
  assert.deepEqual(data.unknownReferences, ['PRD-0007'])
  assert.ok(lines.length < 25, 'fits on one screen')
})

test('list returns the index as data, filtered by kind and status', () => {
  const repository = createRepository()
  repository.run('new', 'adr', 'Use queues')
  assert.deepEqual(repository.run('list').data.map((/** @type {{ id: string }} */ each) => each.id), ['PRD-0001', 'ADR-0001', 'ADR-0002'])
  assert.deepEqual(repository.run('list', 'adr', '--status', 'proposed').data.map((/** @type {{ id: string }} */ each) => each.id), ['ADR-0002'])
  assert.equal(repository.failure('list', '--status', 'done').code, 'invalid-arguments')
})

test('show resolves an ID to its document or one section of it', () => {
  const repository = createRepository()
  assert.equal(repository.run('show', 'adr-1').data.content, adr({}))
  assert.equal(repository.run('show', 'ADR-0001', '--section', 'decision').data.content, '## Decision\n\nWe will.\n')
  assert.match(repository.failure('show', 'ADR-0001', '--section', 'Risks').message, /It has: Context, Decision, Consequences/)
  assert.equal(repository.failure('show', 'ADR-0042').code, 'unknown-document')
})

// === ENFORCING ===

test('check reports findings and exits 1 only when there are errors', () => {
  const repository = createRepository()
  assert.deepEqual(repository.run('check').data, { ok: true, findings: [] })
  repository.write('notes.txt', 'x')
  assert.equal(repository.run('check').exitCode, 0, 'a warning does not fail the check')
  repository.write('docs/adr/0003-skip-a-number.md', adr({ id: 'ADR-0003' }))
  const { data, exitCode } = repository.run('check')
  assert.equal(data.ok, false)
  assert.equal(exitCode, 1)
})

test('check --fix repairs a stale index, a mismatched id and a missing reciprocal supersede', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-postgres.md', adr({ id: 'ADR-0007', extra: 'supersedes: ADR-0001' }))
  assert.deepEqual(repository.codes('error').sort(), ['id-mismatch', 'stale-index', 'supersede-not-reciprocal'])
  const { data, changes } = repository.run('check', '--fix')
  assert.deepEqual(data, { ok: true, findings: [] })
  assert.deepEqual(changes.map((change) => change.path).sort(), [ADR_PATH, 'docs/adr/0002-use-postgres.md', 'docs/adr/INDEX.md'])
})

test('check --fix reports what it cannot repair', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-no-consequences.md', adr({ id: 'ADR-0002' }).replace('## Consequences', '## Outcome'))
  const { data, exitCode } = repository.run('check', '--fix')
  assert.deepEqual(data.findings.map((/** @type {{ code: string }} */ finding) => finding.code), ['missing-section'])
  assert.equal(exitCode, 1)
})

test('index regenerates the indexes', () => {
  const repository = createRepository()
  repository.write('docs/adr/0002-use-queues.md', adr({ id: 'ADR-0002' }))
  assert.deepEqual(repository.run('index').changes.map((change) => change.path), ['docs/adr/INDEX.md'])
  assert.deepEqual(repository.codes('error'), [])
})

test('doctor reports each piece of wiring that is missing, and passes when it is all there', () => {
  const repository = createRepository()
  const { data, exitCode } = repository.run('doctor')
  assert.deepEqual(data.problems.map((/** @type {{ code: string }} */ problem) => problem.code), ['script-missing', 'agents-md-unmanaged', 'workflow-missing', 'hook-not-installed'])
  assert.equal(exitCode, 1)

  repository.write('scripts/whatwhy.mjs', '')
  repository.write('AGENTS.md', '<!-- whatwhy:begin -->\n<!-- whatwhy:end -->\n')
  repository.write('.github/workflows/whatwhy.yml', 'run: node scripts/whatwhy.mjs check\n')
  repository.write('.githooks/commit-msg', '#!/bin/sh\nexec node scripts/whatwhy.mjs check\n')
  repository.git('config', 'core.hooksPath', '.githooks')
  assert.deepEqual(repository.run('doctor').data.problems.map((/** @type {{ code: string }} */ problem) => problem.code), ['hook-not-executable'])
  execFileSync('chmod', ['+x', join(repository.root, '.githooks/commit-msg')])
  assert.deepEqual(repository.run('doctor').data, { ok: true, version: VERSION, problems: [] })
})

test('doctor reports an invalid config and a base branch that does not exist', () => {
  const repository = createRepository()
  repository.write('whatwhy.config.json', JSON.stringify({ baseBranch: 'trunk' }))
  assert.ok(repository.run('doctor').data.problems.some((/** @type {{ code: string }} */ problem) => problem.code === 'base-branch-not-found'))
  repository.write('whatwhy.config.json', '{ not json')
  assert.ok(repository.run('doctor').data.problems.some((/** @type {{ code: string }} */ problem) => problem.code === 'invalid-configuration'))
})

// === EVERY COMMAND ===

const MUTATIONS = [
  ['new', 'adr', 'Use queues'],
  ['new', 'adr', 'Use Postgres', '--supersedes', 'ADR-0001'],
  ['new', 'prd', 'Team accounts'],
  ['deprecate', 'ADR-0001'],
  ['ship', 'PRD-0001'],
  ['abandon', 'PRD-0001'],
  ['check', '--fix'],
  ['index'],
]

for (const mutation of MUTATIONS) {
  test(`\`${mutation.join(' ')}\` with --dry-run reports its changes and writes nothing`, () => {
    const repository = createRepository()
    repository.write('docs/adr/0002-stale.md', adr({ id: 'ADR-0002' })) // gives `index` and `check --fix` something to do
    repository.commit('docs: add an ADR without indexing it (ADR-0002)')
    const { changes } = repository.run(...mutation, '--dry-run')
    assert.ok(changes.length > 0)
    assert.equal(repository.git('status', '--porcelain'), '')
  })

  test(`\`${mutation.join(' ')}\` run twice succeeds and changes nothing the second time`, () => {
    const repository = createRepository()
    repository.write('docs/adr/0002-stale.md', adr({ id: 'ADR-0002' }))
    assert.ok(repository.run(...mutation).changes.length > 0)
    const snapshot = repository.git('status', '--porcelain') + repository.git('diff')
    const second = repository.run(...mutation)
    assert.deepEqual(second.changes, [])
    assert.equal(second.exitCode, 0)
    assert.equal(repository.git('status', '--porcelain') + repository.git('diff'), snapshot)
  })
}

test('an unknown command, option or misplaced option fails with a code and a way forward', () => {
  const repository = createRepository()
  assert.equal(repository.failure('publish').code, 'unknown-command')
  assert.equal(repository.failure('list', '--colour').code, 'invalid-arguments')
  assert.match(repository.failure('list', '--dry-run').message, /`list` does not take --dry-run/)
  assert.equal(repository.failure('check', '--dry-run').code, 'invalid-arguments')
})

test('--json prints the result envelope, and a failure as code, message and retryable with exit code 2', () => {
  const repository = createRepository()
  const run = (/** @type {string[]} */ ...commandLine) => spawnSync(process.execPath, [SCRIPT_PATH, ...commandLine, '--json'], { cwd: repository.root, encoding: 'utf8', input: '' })

  const created = run('new', 'adr', 'Use queues')
  assert.equal(created.status, 0)
  assert.deepEqual(Object.keys(JSON.parse(created.stdout)), ['data', 'changes', 'warnings'])

  const failed = run('show', 'ADR-0042')
  assert.equal(failed.status, 2)
  assert.deepEqual(Object.keys(JSON.parse(failed.stdout)), ['code', 'message', 'retryable'])

  repository.write('docs/adr/0004-gap.md', adr({ id: 'ADR-0004' }))
  const checked = run('check')
  assert.equal(checked.status, 1)
  assert.equal(JSON.parse(checked.stdout).data.ok, false)
})

test('the script reports the version in package.json', () => {
  assert.equal(VERSION, JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version)
})

// === FIXTURES ===

/** A committed repository on a feature branch with one PRD and one accepted ADR. */
function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'whatwhy-test-'))
  test.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (/** @type {string[]} */ ...gitArguments) =>
    execFileSync('git', ['-c', 'user.name=whatwhy', '-c', 'user.email=whatwhy@example.invalid', '-c', 'commit.gpgsign=false', ...gitArguments], { cwd: root, encoding: 'utf8', stdio: 'pipe' })

  const repository = {
    root,
    git,
    read: (/** @type {string} */ path) => readFileSync(join(root, path), 'utf8'),
    /** @returns {Omit<import('./whatwhy.mjs').CommandResult, 'data'> & { data: any }} */
    run: (/** @type {string[]} */ ...commandLine) => runCommand(root, commandLine),
    /** @returns {CommandError} the failure the command must end in */
    failure(/** @type {string[]} */ ...commandLine) {
      try {
        runCommand(root, commandLine)
      } catch (error) {
        if (error instanceof CommandError) return error
        throw error
      }
      throw new Error(`Expected \`${commandLine.join(' ')}\` to fail.`)
    },
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
  repository.write(PRD_PATH, prd())
  repository.write(ADR_PATH, adr({ id: 'ADR-0001' }))
  for (const kind of ['adr', 'prd']) repository.write(`docs/${kind}/TEMPLATE.md`, readFileSync(join(PACKAGE_ROOT, `docs/${kind}/TEMPLATE.md`), 'utf8'))
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

function localDate() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}
