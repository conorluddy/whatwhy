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
const ELSEWHERE = ['--adr-dir', 'specifications/decisions', '--prd-dir', 'specifications/requirements']

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

test('a README.md in a document folder is not a document', () => {
  const repository = createRepository()
  repository.write('docs/adr/README.md', '# How we write decisions\n')
  assert.deepEqual(repository.codes('error'), [])
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

test('an ID written with a space, as in "ADR 0001", counts as a reference', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  repository.commit('feat: add feature, as decided in ADR 0001')
  assert.deepEqual(repository.check(), [])
  assert.deepEqual(repository.run('status').data.referenced.map((/** @type {{ id: string }} */ each) => each.id), ['ADR-0001'])
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

test('documents are read from and written to the folders the config names', () => {
  const repository = createEmptyRepository()
  repository.write('whatwhy.config.json', JSON.stringify({ directories: { adr: 'specifications/decisions/', prd: './specifications/requirements' } }))
  repository.write('specifications/requirements/0001-first-product.md', prd())
  repository.write('specifications/decisions/0001-use-sqlite.md', adr({}))
  for (const [kind, folder] of [['adr', 'decisions'], ['prd', 'requirements']]) repository.write(`specifications/${folder}/TEMPLATE.md`, readFileSync(join(PACKAGE_ROOT, `docs/${kind}/TEMPLATE.md`), 'utf8'))
  assert.deepEqual(repository.reindex(), ['specifications/decisions/INDEX.md', 'specifications/requirements/INDEX.md'])
  repository.commit('chore: initial commit')
  repository.git('checkout', '-q', '-b', 'feature/work')

  assert.equal(repository.run('new', 'adr', 'Use queues', '--prd', 'PRD-0001').data.path, 'specifications/decisions/0002-use-queues.md')
  assert.equal(repository.run('new', 'prd', 'Team accounts').data.path, 'specifications/requirements/0002-team-accounts.md')
  assert.deepEqual(repository.run('list').data.map((/** @type {{ id: string }} */ each) => each.id), ['PRD-0001', 'PRD-0002', 'ADR-0001', 'ADR-0002'])
  assert.deepEqual(repository.check(), [], 'the new ADR satisfies traceability and architecture from its configured folder')
  assert.equal(existsSync(join(repository.root, 'docs')), false)

  repository.write('specifications/decisions/0001-use-sqlite.md', adr({}).replace('We will.', 'We will not.'))
  assert.deepEqual(repository.codes('error'), ['frozen-adr-edited'])
  assert.match(repository.failure('show', 'ADR-0042').message, /See specifications\/decisions\/INDEX\.md/)
})

test('a document folder outside the repository, or shared by both kinds, fails with a message naming the setting', () => {
  const repository = createRepository()
  for (const adrDirectory of ['/tmp/decisions', '../decisions', '.', '']) {
    repository.write('whatwhy.config.json', JSON.stringify({ directories: { adr: adrDirectory } }))
    assert.throws(() => repository.check(), (/** @type {CommandError} */ error) => error.code === 'invalid-configuration' && /directories\.adr is ".*"\. Expected a folder inside the repository/.test(error.message), adrDirectory)
  }
  repository.write('whatwhy.config.json', JSON.stringify({ directories: { adr: 'docs/prd' } }))
  assert.throws(() => repository.check(), /directories\.adr and .*directories\.prd are both "docs\/prd"/)
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

test('check --errors-only leaves out warnings, and keeps a rule the config sets to error', () => {
  const repository = createRepository()
  repository.write('src/feature.js', 'export {}\n')
  assert.deepEqual(repository.run('check').data.findings.map((/** @type {{ code: string }} */ finding) => finding.code), ['missing-spec-reference'])
  const quiet = repository.run('check', '--errors-only')
  assert.deepEqual(quiet.data, { ok: true, findings: [] })
  assert.deepEqual(quiet.lines, ['whatwhy: 0 error(s)'])

  repository.write('whatwhy.config.json', JSON.stringify({ rules: { traceability: 'error' } }))
  const blocked = repository.run('check', '--errors-only')
  assert.deepEqual(blocked.data.findings.map((/** @type {{ code: string }} */ finding) => finding.code), ['missing-spec-reference'])
  assert.equal(blocked.exitCode, 1)
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

// === SETUP ===

test('init in an empty repository, then one commit, leaves a repository that passes the check and the doctor', () => {
  const repository = createEmptyRepository()
  const { changes } = repository.run('init', '--name', 'Acme', '--description', 'Invoicing for freelancers.')
  assert.deepEqual(changes.at(-1), { action: 'configure', path: '.git/config', summary: 'core.hooksPath = .githooks' })
  assert.match(repository.read('AGENTS.md'), /^\*\*Acme\*\*: Invoicing for freelancers\.$/m)
  assert.doesNotMatch(repository.read('AGENTS.md'), /\{\{|ADR-\d{4}/, 'no placeholders, and no ADR numbers that this repository does not have')
  assert.equal(repository.read('scripts/whatwhy.mjs'), readFileSync(SCRIPT_PATH, 'utf8'))

  repository.commit('chore: adopt whatwhy\n\nno-spec: adopting whatwhy\nno-adr: adopting whatwhy') // runs the vendored script through the installed hook
  assert.deepEqual(repository.run('check').data, { ok: true, findings: [] })
  assert.deepEqual(repository.run('doctor').data.problems, [])
  assert.equal(repository.run('new', 'prd', 'First product').data.id, 'PRD-0001')
})

test('the hook that init installs blocks a commit that breaks the structure rule', () => {
  const repository = createEmptyRepository()
  repository.run('init')
  repository.commit('chore: adopt whatwhy')
  repository.write('docs/adr/0002-skips-a-number.md', adr({ id: 'ADR-0002' }))
  assert.throws(() => repository.commit('docs: add an ADR (ADR-0002)'), /numbering-not-contiguous/)
})

test('the hook that init installs lets a commit with only warnings through without printing them', () => {
  const repository = createEmptyRepository()
  repository.run('init')
  repository.commit('chore: adopt whatwhy')
  repository.git('checkout', '-q', '-b', 'feature/work')
  repository.write('src/feature.js', 'export {}\n')
  assert.deepEqual(repository.codes('warn'), ['missing-spec-reference'])
  repository.git('add', '-A')
  const commit = spawnSync('git', ['-c', 'user.name=whatwhy', '-c', 'user.email=whatwhy@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'feat: add feature'], { cwd: repository.root, encoding: 'utf8' })
  assert.equal(commit.status, 0)
  assert.match(commit.stdout + commit.stderr, /whatwhy: 0 error\(s\)\n/)
  assert.doesNotMatch(commit.stdout + commit.stderr, /warn/)
})

test('init says where to add house sections, in the folders it was given', () => {
  const repository = createEmptyRepository()
  const { lines } = repository.run('init', '--adr-dir', 'specifications/decisions')
  assert.match(lines.join('\n'), /Add them to specifications\/decisions\/TEMPLATE\.md and docs\/prd\/TEMPLATE\.md\. `upgrade` leaves both alone\./)
  assert.doesNotMatch(repository.run('init').lines.join('\n'), /TEMPLATE\.md/)
})

test('init in an existing repository keeps every file that is already there', () => {
  const repository = createRepository()
  repository.write('AGENTS.md', '# AGENTS.md\n\nOur own guidance.\n')
  repository.write('.githooks/commit-msg', '#!/bin/sh\n# ours\n')
  const configuration = repository.read('whatwhy.config.json')
  const { changes, warnings } = repository.run('init', '--name', 'Acme')
  assert.deepEqual(changes.find((change) => change.path === 'AGENTS.md'), { action: 'update', path: 'AGENTS.md', summary: 'process section appended' })
  assert.match(repository.read('AGENTS.md'), /^# AGENTS\.md\n\nOur own guidance\.\n\n<!-- whatwhy:begin[\s\S]*<!-- whatwhy:end -->\n$/)
  assert.equal(repository.read('.githooks/commit-msg'), '#!/bin/sh\n# ours\n')
  assert.equal(repository.read('whatwhy.config.json'), configuration)
  assert.equal(repository.read(ADR_PATH), adr({}))
  assert.match(warnings.join(), /--name and --description were not used/)
  assert.deepEqual(repository.codes('error'), [])
})

test('init --adr-dir and --prd-dir put the documents elsewhere, and every later command follows', () => {
  const repository = createEmptyRepository()
  const { data, changes } = repository.run('init', ...ELSEWHERE)
  assert.deepEqual(data.directories, { adr: 'specifications/decisions', prd: 'specifications/requirements' })
  assert.deepEqual(JSON.parse(repository.read('whatwhy.config.json')).directories, data.directories)
  assert.deepEqual(changes.map((change) => change.path).filter((path) => path.startsWith('specifications/')).sort(), [
    'specifications/decisions/INDEX.md',
    'specifications/decisions/TEMPLATE.md',
    'specifications/requirements/INDEX.md',
    'specifications/requirements/TEMPLATE.md',
  ])
  assert.equal(existsSync(join(repository.root, 'docs')), false)

  repository.commit('chore: adopt whatwhy\n\nno-spec: adopting whatwhy\nno-adr: adopting whatwhy')
  assert.equal(repository.run('new', 'adr', 'Use queues').data.path, 'specifications/decisions/0001-use-queues.md')
  assert.deepEqual(repository.run('check').data, { ok: true, findings: [] })
  assert.deepEqual(repository.run('doctor').data.problems, [])
})

test('init does not use --adr-dir or --prd-dir when the config already exists, and says so', () => {
  const repository = createRepository()
  const configuration = repository.read('whatwhy.config.json')
  const { data, warnings } = repository.run('init', ...ELSEWHERE)
  assert.match(warnings.join(), /--adr-dir and --prd-dir were not used/)
  assert.deepEqual(data.directories, { adr: 'docs/adr', prd: 'docs/prd' })
  assert.equal(repository.read('whatwhy.config.json'), configuration)
  assert.equal(existsSync(join(repository.root, 'specifications')), false)
})

test('init rejects a folder outside the repository', () => {
  const repository = createEmptyRepository()
  const failure = repository.failure('init', '--adr-dir', '../decisions')
  assert.equal(failure.code, 'invalid-arguments')
  assert.match(failure.message, /--adr-dir is "\.\.\/decisions"/)
  assert.equal(repository.git('status', '--porcelain'), '')
})

test('init refuses to start a second decisions folder beside existing ADRs, and writes nothing', () => {
  const repository = createEmptyRepository()
  repository.write('specifications/decisions/0001-use-sqlite.md', legacyAdr({}))
  repository.write('specifications/decisions/README.md', '# Decisions\n')
  repository.commit('docs: record a decision')

  const failure = repository.failure('init')
  assert.equal(failure.code, 'existing-decisions-found')
  assert.match(failure.message, /already keeps decisions in specifications\/decisions/)
  assert.match(failure.message, /init --adr-dir specifications\/decisions/, 'how to adopt them')
  assert.match(failure.message, /init --adr-dir docs\/adr/, 'how to keep them apart')
  assert.equal(repository.git('status', '--porcelain'), '')
  assert.throws(() => repository.git('config', '--get', 'core.hooksPath'))

  assert.equal(repository.run('init', '--adr-dir', 'specifications/decisions', '--dry-run').data.directories.adr, 'specifications/decisions')
  assert.equal(repository.run('init', '--adr-dir', 'docs/adr').data.directories.adr, 'docs/adr', 'naming the default folder keeps the two apart on purpose')
})

test('init adopts ADRs that are already in the folder it would use', () => {
  const repository = createEmptyRepository()
  repository.write('docs/adr/0001-use-sqlite.md', legacyAdr({}))
  repository.commit('docs: record a decision')
  assert.equal(repository.run('init').data.directories.adr, 'docs/adr')
})

test('init leaves an existing hooks path alone and says how to wire the hook in', () => {
  const repository = createEmptyRepository()
  repository.git('config', 'core.hooksPath', '.husky')
  const { warnings } = repository.run('init')
  assert.match(warnings.join(), /git runs hooks from "\.husky".*exec node scripts\/whatwhy\.mjs check --errors-only --message-file/)
  assert.equal(repository.git('config', '--get', 'core.hooksPath').trim(), '.husky')
})

test('init takes the base branch from a repository that has not committed yet', () => {
  const repository = createEmptyRepository('trunk')
  assert.equal(repository.run('init').data.baseBranch, 'trunk')
  assert.equal(JSON.parse(repository.read('whatwhy.config.json')).baseBranch, 'trunk')
})

test('init outside a git repository fails and says what to run', () => {
  const root = mkdtempSync(join(tmpdir(), 'whatwhy-test-'))
  test.after(() => rmSync(root, { recursive: true, force: true }))
  assert.throws(() => runCommand(root, ['init']), (/** @type {CommandError} */ error) => error.code === 'not-a-repository' && /git init/.test(error.message))
})

test('upgrade refreshes the script and the managed section, and nothing else', () => {
  const repository = createEmptyRepository()
  repository.run('init', '--name', 'Acme')
  repository.run('new', 'adr', 'Use queues')
  const agents = repository.read('AGENTS.md')
  const edited = agents.replace('**Acme**', '**Acme Ltd**').replace('## The check', '## The cheque')
  repository.write('AGENTS.md', edited)
  repository.write('scripts/whatwhy.mjs', '// an older version\n')
  repository.write('docs/adr/TEMPLATE.md', 'an edited template\n')
  repository.write('whatwhy.config.json', '{ "baseBranch": "main", "architecturalPaths": [] }\n')
  const adrText = repository.read('docs/adr/0001-use-queues.md')

  const { changes } = repository.run('upgrade')
  assert.deepEqual(changes.map((change) => change.path), ['scripts/whatwhy.mjs', 'AGENTS.md'])
  assert.equal(repository.read('docs/adr/TEMPLATE.md'), 'an edited template\n')
  assert.equal(repository.read('AGENTS.md'), agents.replace('**Acme**', '**Acme Ltd**'))
  assert.equal(repository.read('scripts/whatwhy.mjs'), readFileSync(SCRIPT_PATH, 'utf8'))
  assert.equal(repository.read('docs/adr/0001-use-queues.md'), adrText)
  assert.equal(repository.read('whatwhy.config.json'), '{ "baseBranch": "main", "architecturalPaths": [] }\n')
})

test('upgrade restores a template that is missing and keeps one that was edited', () => {
  const repository = createEmptyRepository()
  repository.run('init')
  const prdTemplate = repository.read('docs/prd/TEMPLATE.md')
  rmSync(join(repository.root, 'docs/prd/TEMPLATE.md'))
  repository.write('docs/adr/TEMPLATE.md', `${repository.read('docs/adr/TEMPLATE.md')}\n## Revisit when\n\nWhat would reopen this decision.\n`)

  const { changes } = repository.run('upgrade')
  assert.deepEqual(changes.map((change) => change.path), ['docs/prd/TEMPLATE.md'])
  assert.equal(repository.read('docs/prd/TEMPLATE.md'), prdTemplate)
  repository.run('new', 'adr', 'Use queues')
  assert.match(repository.read('docs/adr/0001-use-queues.md'), /^## Revisit when$/m)
})

test('upgrade leaves an AGENTS.md without markers untouched and says so', () => {
  const repository = createEmptyRepository()
  repository.run('init')
  const withoutMarker = repository.read('AGENTS.md').replace('<!-- whatwhy:end -->\n', '')
  repository.write('AGENTS.md', withoutMarker)
  const { changes, warnings } = repository.run('upgrade')
  assert.deepEqual(changes, [])
  assert.match(warnings.join(), /process text was not refreshed/)
  assert.equal(repository.read('AGENTS.md'), withoutMarker)
  assert.deepEqual(repository.run('doctor').data.problems.map((/** @type {{ code: string }} */ problem) => problem.code), ['agents-md-unmanaged'])
})

test('a vendored copy runs init again harmlessly, and sends upgrade to the package', () => {
  const repository = createEmptyRepository()
  repository.run('init')
  const vendored = (/** @type {string} */ command) => spawnSync(process.execPath, ['scripts/whatwhy.mjs', command, '--json'], { cwd: repository.root, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(vendored('init').stdout).changes, [])
  const upgrade = vendored('upgrade')
  assert.equal(upgrade.status, 2)
  assert.equal(JSON.parse(upgrade.stdout).code, 'templates-unavailable')
})

test('this repository matches the templates it gives to others', () => {
  for (const [template, path] of Object.entries({
    'adr.md': 'docs/adr/TEMPLATE.md',
    'prd.md': 'docs/prd/TEMPLATE.md',
    'config.json': 'whatwhy.config.json',
    'commit-msg': '.githooks/commit-msg',
    'workflow.yml': '.github/workflows/whatwhy.yml',
    'pull_request_template.md': '.github/pull_request_template.md',
    'CLAUDE.md': 'CLAUDE.md',
  })) {
    assert.equal(readFileSync(join(PACKAGE_ROOT, path), 'utf8'), readFileSync(join(PACKAGE_ROOT, 'templates', template), 'utf8'), `${path} differs from templates/${template}`)
  }
  const managed = (/** @type {string} */ path) => /<!-- whatwhy:begin[\s\S]*<!-- whatwhy:end -->/.exec(readFileSync(join(PACKAGE_ROOT, path), 'utf8'))?.[0]
  assert.ok(managed('AGENTS.md'))
  assert.equal(managed('AGENTS.md'), managed('templates/AGENTS.md'))
  for (const path of ['AGENTS.md', 'templates/AGENTS.md']) assert.ok(readFileSync(join(PACKAGE_ROOT, path), 'utf8').split('\n').length <= 100, `${path} is over 100 lines`)
})

for (const setup of [['init'], ['init', ...ELSEWHERE], ['upgrade']]) {
  const [command] = setup
  const firstInit = command === 'init' ? setup : ['init']

  test(`\`${setup.join(' ')}\` with --dry-run reports its changes and writes nothing`, () => {
    const repository = createEmptyRepository()
    if (command === 'upgrade') {
      repository.run('init')
      repository.write('scripts/whatwhy.mjs', '// an older version\n')
      repository.commit('chore: adopt whatwhy', '--no-verify')
    }
    assert.ok(repository.run(...setup, '--dry-run').changes.length > 0)
    assert.equal(repository.git('status', '--porcelain'), '')
    if (command === 'init') assert.throws(() => repository.git('config', '--get', 'core.hooksPath'))
  })

  test(`\`${setup.join(' ')}\` run twice succeeds and changes nothing the second time`, () => {
    const repository = createEmptyRepository()
    repository.run(...firstInit)
    repository.write('scripts/whatwhy.mjs', '// an older version\n')
    repository.run(...setup)
    const snapshot = repository.git('status', '--porcelain')
    assert.deepEqual(repository.run(...setup).changes, [])
    assert.equal(repository.git('status', '--porcelain'), snapshot)
  })
}

// === IMPORT ===

test('import converts ADRs written before whatwhy, in place, keeping numbers and extra sections', () => {
  const repository = createLegacyRepository({
    '0001-use-sqlite.md': legacyAdr({}),
    '0002-use-files.md': legacyAdr({ number: '0002', title: 'Use files: one per "record"', metadata: 'Date: 2026-10-27\nStatus: superseded by 0003\n\nSuperseded by: 0003' }),
    '0003-use-postgres.md': legacyAdr({ number: '0003', title: 'Use Postgres', metadata: 'Date: 2026-10-28\nStatus: proposed' }),
    'README.md': '# Decisions\n\nDate: YYYY-MM-DD\nStatus: proposed | accepted | superseded by NNNN\n',
  })
  assert.match(repository.run('init', '--adr-dir', 'specifications/decisions').lines.join('\n'), /holds ADRs written before whatwhy\. Run `node scripts\/whatwhy\.mjs import`/)
  const invalid = repository.check().filter((finding) => finding.code === 'invalid-frontmatter')
  assert.equal(invalid.length, 3)
  assert.match(invalid[0].message, /or run `node scripts\/whatwhy\.mjs import`/)

  const { data, changes, warnings } = repository.run('import')
  assert.deepEqual(data.imported.map((/** @type {{ id: string, status: string, title: string, date: string }} */ each) => [each.id, each.status, each.title, each.date]), [
    ['ADR-0001', 'accepted', 'Use SQLite', '2026-10-26'],
    ['ADR-0002', 'superseded', 'Use files: one per "record"', '2026-10-27'],
    ['ADR-0003', 'proposed', 'Use Postgres', '2026-10-28'],
  ])
  assert.equal(data.imported[1].supersededBy, 'ADR-0003')
  assert.deepEqual(data.skipped, [])
  assert.deepEqual(warnings, [])
  assert.deepEqual(changes.map((change) => `${change.action} ${change.path}`), [
    'update specifications/decisions/0001-use-sqlite.md',
    'update specifications/decisions/0002-use-files.md',
    'update specifications/decisions/0003-use-postgres.md',
    'update specifications/decisions/INDEX.md',
  ])
  assert.equal(
    repository.read('specifications/decisions/0002-use-files.md'),
    `---\nid: ADR-0002\ntitle: 'Use files: one per "record"'\nstatus: superseded\ndate: "2026-10-27"\nsuperseded-by: ADR-0003\n---\n\n${legacyAdr({ number: '0002', title: 'Use files: one per "record"', metadata: '' })}`,
  )
  assert.match(repository.read('specifications/decisions/README.md'), /^Status: proposed/m, 'the README is not an ADR')
  assert.deepEqual(repository.check(), [], 'no structure errors, and converting an accepted ADR is not an edit to a frozen one')
  assert.equal(repository.run('show', 'ADR-0001', '--section', 'Revisit when').data.content, '## Revisit when\n\nIt hurts.\n')
})

test('import reads a "## Status" section, and drops it only when the status is all it says', () => {
  const nygard = (/** @type {string} */ status) => `# 1. Record decisions\n\nDate: 2026-01-02\n\n## Status\n\n${status}\n\n## Context\n\nWhy.\n\n## Decision\n\nWe will.\n\n## Consequences\n\nThen.\n`
  const repository = createLegacyRepository({
    '0001-record-decisions.md': nygard('Accepted'),
    '0002-keep-the-note.md': nygard('Accepted\n\nAmended by the team in March.').replace('# 1.', '# ADR-0002:'),
  })
  repository.run('init', '--adr-dir', 'specifications/decisions')
  assert.deepEqual(repository.run('import').data.imported.map((/** @type {{ status: string, title: string }} */ each) => [each.status, each.title]), [['accepted', 'Record decisions'], ['accepted', 'Record decisions']])
  assert.equal(repository.read('specifications/decisions/0001-record-decisions.md'), '---\nid: ADR-0001\ntitle: Record decisions\nstatus: accepted\ndate: "2026-01-02"\n---\n\n# 1. Record decisions\n\n## Context\n\nWhy.\n\n## Decision\n\nWe will.\n\n## Consequences\n\nThen.\n')
  assert.match(repository.read('specifications/decisions/0002-keep-the-note.md'), /## Status\n\nAccepted\n\nAmended by the team in March\.\n\n## Context/)
  assert.deepEqual(repository.codes('error'), [])
})

test('import dates an ADR that states no date from the commit that added it', () => {
  const repository = createEmptyRepository()
  repository.write('docs/adr/0001-use-sqlite.md', legacyAdr({ metadata: 'Status: accepted' }))
  repository.commit('docs: record a decision', '--date=2025-03-04T12:00:00')
  repository.run('init')
  repository.write('docs/adr/0001-use-sqlite.md', `${repository.read('docs/adr/0001-use-sqlite.md')}\nA later note.\n`)
  repository.commit('docs: add a note', '--date=2025-06-07T12:00:00', '--no-verify')
  assert.equal(repository.run('import').data.imported[0].date, '2025-03-04')
})

test('import skips what it cannot read exactly, says why, and leaves the file untouched', () => {
  const files = {
    '0001-no-heading.md': 'Date: 2026-10-26\nStatus: accepted\n\n## Context\n',
    '0002-no-status.md': legacyAdr({ number: '0002', metadata: 'Date: 2026-10-26' }),
    '0003-unknown-status.md': legacyAdr({ number: '0003', metadata: 'Date: 2026-10-26\nStatus: in review' }),
    '0004-superseded-by-nothing.md': legacyAdr({ number: '0004', metadata: 'Date: 2026-10-26\nStatus: superseded' }),
    '0005-bad-date.md': legacyAdr({ number: '0005', metadata: 'Date: 26 October 2026\nStatus: accepted' }),
    '0006-nested-frontmatter.md': '---\ntags:\n  - one\n---\n\n# 0006. Nested\n',
    'Use_Queues.md': legacyAdr({ number: '0007' }),
  }
  const repository = createLegacyRepository(files)
  repository.run('init', '--adr-dir', 'specifications/decisions')
  repository.write('specifications/decisions/0008-never-committed.md', legacyAdr({ number: '0008', metadata: 'Status: accepted' }))
  const { data, changes } = repository.run('import')
  assert.deepEqual(data.imported, [])
  assert.deepEqual(changes, [])
  assert.deepEqual(data.skipped.map((/** @type {{ path: string, reason: string }} */ each) => [each.path.split('/').at(-1), each.reason.split(/[.:]/)[0]]), [
    ['0001-no-heading.md', 'It has no `# ` heading to take the title from'],
    ['0002-no-status.md', 'It has no `Status'],
    ['0003-unknown-status.md', 'Its status is "in review"'],
    ['0004-superseded-by-nothing.md', 'It is superseded but does not say by which ADR'],
    ['0005-bad-date.md', 'Its date is "26 October 2026"'],
    ['0006-nested-frontmatter.md', 'It opens with a `---` block that is not flat `key'],
    ['0008-never-committed.md', 'It has no `Date'],
    ['Use_Queues.md', 'The filename is not NNNN-kebab-case-title'],
  ])
  for (const [fileName, content] of Object.entries(files)) assert.equal(repository.read(`specifications/decisions/${fileName}`), content)
})

test('import warns about an imported ADR the check will reject, while it can still be fixed', () => {
  const repository = createLegacyRepository({ '0001-use-sqlite.md': legacyAdr({}).replace('## Consequences', '## Outcome') })
  repository.run('init', '--adr-dir', 'specifications/decisions')
  const { data, warnings } = repository.run('import')
  assert.equal(data.imported.length, 1)
  assert.match(warnings.join(), /0001-use-sqlite\.md: Add a "## Consequences" section.*Fix it before this import is merged/)
})

test('`import` with --dry-run reports its changes and writes nothing', () => {
  const repository = createLegacyRepository({ '0001-use-sqlite.md': legacyAdr({}) })
  repository.run('init', '--adr-dir', 'specifications/decisions')
  repository.commit('chore: adopt whatwhy', '--no-verify')
  const { data, changes } = repository.run('import', '--dry-run')
  assert.deepEqual(changes.map((change) => change.path), ['specifications/decisions/0001-use-sqlite.md', 'specifications/decisions/INDEX.md'])
  assert.equal(data.imported[0].id, 'ADR-0001')
  assert.equal(repository.git('status', '--porcelain'), '')
})

test('`import` run twice succeeds and changes nothing the second time', () => {
  const repository = createLegacyRepository({ '0001-use-sqlite.md': legacyAdr({}), '0002-no-status.md': legacyAdr({ number: '0002', metadata: '' }) })
  repository.run('init', '--adr-dir', 'specifications/decisions')
  assert.equal(repository.run('import').changes.length, 2)
  const snapshot = repository.git('status', '--porcelain') + repository.git('diff')
  const second = repository.run('import')
  assert.deepEqual(second.changes, [])
  assert.deepEqual(second.data.imported, [])
  assert.equal(second.data.skipped.length, 1, 'what could not be converted is reported every time')
  assert.equal(second.exitCode, 0)
  assert.equal(repository.git('status', '--porcelain') + repository.git('diff'), snapshot)
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
  const repository = createEmptyRepository()
  repository.write('whatwhy.config.json', JSON.stringify({ architecturalPaths: ['**/package.json'] }))
  repository.write(PRD_PATH, prd())
  repository.write(ADR_PATH, adr({ id: 'ADR-0001' }))
  for (const kind of ['adr', 'prd']) repository.write(`docs/${kind}/TEMPLATE.md`, readFileSync(join(PACKAGE_ROOT, `docs/${kind}/TEMPLATE.md`), 'utf8'))
  repository.reindex()
  repository.commit('chore: initial commit')
  repository.git('checkout', '-q', '-b', 'feature/work')
  assert.match(repository.read('docs/adr/INDEX.md'), /ADR-0001/)
  return repository
}

/** A repository on a feature branch whose main has ADRs written before whatwhy in specifications/decisions. @param {Record<string, string>} files by filename */
function createLegacyRepository(files) {
  const repository = createEmptyRepository()
  for (const [fileName, content] of Object.entries(files)) repository.write(`specifications/decisions/${fileName}`, content)
  repository.commit('docs: record decisions')
  repository.git('checkout', '-q', '-b', 'chore/adopt-whatwhy')
  return repository
}

/** A git repository with no files and no commits. @param {string} [initialBranch] */
function createEmptyRepository(initialBranch = 'main') {
  const root = mkdtempSync(join(tmpdir(), 'whatwhy-test-'))
  test.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (/** @type {string[]} */ ...gitArguments) =>
    execFileSync('git', ['-c', 'user.name=whatwhy', '-c', 'user.email=whatwhy@example.invalid', '-c', 'commit.gpgsign=false', ...gitArguments], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', initialBranch)

  return {
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
    commit(/** @type {string} */ message, /** @type {string[]} */ ...flags) {
      git('add', '-A')
      git('commit', '-q', '-m', message, ...flags)
    },
    check: (/** @type {import('./whatwhy.mjs').CheckOptions} */ options = {}) => runChecks(root, options),
    codes: (/** @type {'error' | 'warn'} */ severity, /** @type {import('./whatwhy.mjs').CheckOptions} */ options = {}) =>
      runChecks(root, options).filter((finding) => finding.severity === severity).map((finding) => finding.code),
  }
}

function adr({ id = 'ADR-0001', status = 'accepted', extra = '' }) {
  return `---\nid: ${id}\ntitle: A decision\nstatus: ${status}\ndate: "2026-01-01"\n${extra ? `${extra}\n` : ''}---\n\n## Context\n\nWhy.\n\n## Decision\n\nWe will.\n\n## Consequences\n\nThen.\n`
}

/** An ADR as repositories wrote them before whatwhy: metadata as lines under the heading, no frontmatter. */
function legacyAdr({ number = '0001', title = 'Use SQLite', metadata = 'Date: 2026-10-26\nStatus: accepted' }) {
  return `# ${number}. ${title}\n\n${metadata ? `${metadata}\n\n` : ''}## Context\n\nWhy.\n\n## Options considered\n\n1. One.\n\n## Decision\n\nWe will.\n\n## Consequences\n\nThen.\n\n## Revisit when\n\nIt hurts.\n`
}

function prd() {
  return `---\nid: PRD-0001\ntitle: A product\nstatus: approved\ndate: "2026-01-01"\n---\n\n## Problem\n\n## Goals\n\n## Non-goals\n\n## Requirements\n\n## Success criteria\n`
}

function localDate() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}
