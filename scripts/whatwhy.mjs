#!/usr/bin/env node
// @ts-check
/**
 * whatwhy: enforces the PRD/ADR process described in AGENTS.md.
 * Why it is one dependency-free file: docs/adr/0002.
 *
 *   node scripts/whatwhy.mjs [--json] [--base <ref>] [--message-file <path>]
 *   node scripts/whatwhy.mjs --write-index
 *
 * Exit codes: 0 no errors, 1 rule errors, 2 the check itself could not run.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// === TYPES ===

/** @typedef {'structure' | 'immutability' | 'traceability' | 'architecture'} RuleName */
/** @typedef {'error' | 'warn' | 'off'} Severity */
/** @typedef {{ rule: RuleName, code: string, message: string, file?: string }} Finding */
/** @typedef {Finding & { severity: Severity }} ReportedFinding */
/** @typedef {'adr' | 'prd'} DocumentKind */
/** @typedef {{ frontmatter: Record<string, string>, body: string }} ParsedDocument */
/** @typedef {ParsedDocument & { kind: DocumentKind, path: string, fileName: string, number: number, id: string }} SpecDocument */
/** @typedef {{ baseBranch: string, rules: Record<RuleName, Severity>, architecturalPaths: string[] }} Configuration */
/** @typedef {{ base: string | null, changedFiles: string[], text: string }} ChangeSet */
/** @typedef {{ base?: string, messageFile?: string, pullRequestText?: string }} CheckOptions */

const DOCUMENT_KINDS = {
  adr: {
    directory: 'docs/adr',
    prefix: 'ADR',
    statuses: ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'],
    sections: ['Context', 'Decision', 'Consequences'],
  },
  prd: {
    directory: 'docs/prd',
    prefix: 'PRD',
    statuses: ['draft', 'approved', 'shipped', 'abandoned'],
    sections: ['Problem', 'Goals', 'Non-goals', 'Requirements', 'Success criteria'],
  },
}

/** @type {Configuration} */
const DEFAULT_CONFIGURATION = {
  baseBranch: 'main',
  rules: { structure: 'error', immutability: 'error', traceability: 'warn', architecture: 'warn' },
  architecturalPaths: [],
}

const DOCUMENT_FILE_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/
const NON_DOCUMENT_FILE_NAMES = ['INDEX.md', 'TEMPLATE.md']
const SPEC_REFERENCE = /\b(adr|prd)-(\d{4})\b/gi
const REFERENCE_KEYS = ['prd', 'supersedes', 'superseded-by']

// === PUBLIC API ===

/**
 * Runs every rule and returns the findings whose rule is not switched off.
 * @param {string} repositoryRoot
 * @param {CheckOptions} [options]
 * @returns {ReportedFinding[]}
 */
export function runChecks(repositoryRoot, options = {}) {
  const configuration = loadConfiguration(repositoryRoot)
  const adr = loadDocuments(repositoryRoot, 'adr')
  const prd = loadDocuments(repositoryRoot, 'prd')
  const documents = [...adr.documents, ...prd.documents]
  const changeSet = readChangeSet(repositoryRoot, configuration, options)

  const findings = [
    ...adr.findings,
    ...prd.findings,
    ...checkNumbering(adr.documents),
    ...checkNumbering(prd.documents),
    ...checkCrossReferences(documents),
    ...checkIndex(repositoryRoot, 'adr', adr.documents),
    ...checkIndex(repositoryRoot, 'prd', prd.documents),
    ...checkImmutability(repositoryRoot, changeSet),
    ...checkTraceability(documents, changeSet),
    ...checkArchitecture(configuration, changeSet),
  ]
  return findings
    .map((finding) => ({ ...finding, severity: configuration.rules[finding.rule] }))
    .filter((finding) => finding.severity !== 'off')
}

/**
 * Regenerates docs/adr/INDEX.md and docs/prd/INDEX.md.
 * @param {string} repositoryRoot
 * @returns {string[]} the paths written
 */
export function writeIndexes(repositoryRoot) {
  return /** @type {DocumentKind[]} */ (['adr', 'prd']).map((kind) => {
    const path = `${DOCUMENT_KINDS[kind].directory}/INDEX.md`
    writeFileSync(join(repositoryRoot, path), renderIndex(kind, loadDocuments(repositoryRoot, kind).documents))
    return path
  })
}

// === STRUCTURE RULE ===

/**
 * @param {string} repositoryRoot
 * @param {DocumentKind} kind
 * @returns {{ documents: SpecDocument[], findings: Finding[] }}
 */
function loadDocuments(repositoryRoot, kind) {
  const { directory, prefix } = DOCUMENT_KINDS[kind]
  /** @type {SpecDocument[]} */
  const documents = []
  /** @type {Finding[]} */
  const findings = []
  if (!existsSync(join(repositoryRoot, directory))) return { documents, findings }

  for (const fileName of readdirSync(join(repositoryRoot, directory)).sort()) {
    if (!fileName.endsWith('.md') || NON_DOCUMENT_FILE_NAMES.includes(fileName)) continue
    const path = `${directory}/${fileName}`
    const nameMatch = DOCUMENT_FILE_NAME.exec(fileName)
    if (!nameMatch) {
      findings.push(structureFinding('invalid-filename', path, 'Expected NNNN-kebab-case-title.md, e.g. 0004-use-sqlite.md.'))
      continue
    }
    const parsed = parseDocument(readText(join(repositoryRoot, path)))
    if (!parsed) {
      findings.push(structureFinding('invalid-frontmatter', path, 'Expected the file to open with a `---` block of flat `key: value` lines. Copy TEMPLATE.md.'))
      continue
    }
    const document = { ...parsed, kind, path, fileName, number: Number(nameMatch[1]), id: `${prefix}-${nameMatch[1]}` }
    documents.push(document)
    findings.push(...checkDocument(document))
  }
  return { documents, findings }
}

/** @param {SpecDocument} document @returns {Finding[]} */
function checkDocument(document) {
  const { statuses, sections } = DOCUMENT_KINDS[document.kind]
  const { frontmatter, body, path } = document
  /** @type {Finding[]} */
  const findings = []
  const report = (/** @type {string} */ code, /** @type {string} */ message) => findings.push(structureFinding(code, path, message))

  for (const key of ['id', 'title', 'status', 'date']) {
    if (!frontmatter[key]) report('missing-frontmatter-key', `Frontmatter needs a \`${key}\` value.`)
  }
  if (frontmatter.id && frontmatter.id !== document.id) {
    report('id-mismatch', `Frontmatter id is "${frontmatter.id}" but the filename implies "${document.id}". Make them agree.`)
  }
  if (frontmatter.status && !statuses.includes(frontmatter.status)) {
    report('invalid-status', `Status "${frontmatter.status}" is not one of: ${statuses.join(', ')}.`)
  }
  if (frontmatter.date && !/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.date)) {
    report('invalid-date', `Date "${frontmatter.date}" must be YYYY-MM-DD.`)
  }
  if (frontmatter.status === 'superseded' && !frontmatter['superseded-by']) {
    report('missing-superseded-by', 'A superseded document needs `superseded-by: <ID>` in its frontmatter.')
  }
  const headings = new Set(body.split('\n').map((line) => /^## (.+?)\s*$/.exec(line)?.[1]))
  for (const section of sections.filter((name) => !headings.has(name))) {
    report('missing-section', `Add a "## ${section}" section. Required: ${sections.join(', ')}.`)
  }
  return findings
}

/** @param {SpecDocument[]} documents sorted by filename @returns {Finding[]} */
function checkNumbering(documents) {
  const index = documents.findIndex((document, position) => document.number !== position + 1)
  if (index === -1) return []
  const expected = String(index + 1).padStart(4, '0')
  return [structureFinding('numbering-not-contiguous', documents[index].path, `Expected number ${expected}. Numbers run from 0001 with no gaps or duplicates.`)]
}

/** @param {SpecDocument[]} documents @returns {Finding[]} */
function checkCrossReferences(documents) {
  const documentsById = new Map(documents.map((document) => [document.id, document]))
  /** @type {Finding[]} */
  const findings = []
  for (const document of documents) {
    for (const key of REFERENCE_KEYS) {
      const target = document.frontmatter[key]
      if (target && !documentsById.has(target)) {
        findings.push(structureFinding('unresolved-reference', document.path, `\`${key}: ${target}\` does not match any document.`))
      }
    }
    const superseded = documentsById.get(document.frontmatter.supersedes)
    if (superseded && (superseded.frontmatter.status !== 'superseded' || superseded.frontmatter['superseded-by'] !== document.id)) {
      findings.push(structureFinding('supersede-not-reciprocal', superseded.path, `${document.id} supersedes this document. Set \`status: superseded\` and \`superseded-by: ${document.id}\`.`))
    }
  }
  return findings
}

/** @param {string} repositoryRoot @param {DocumentKind} kind @param {SpecDocument[]} documents @returns {Finding[]} */
function checkIndex(repositoryRoot, kind, documents) {
  const path = `${DOCUMENT_KINDS[kind].directory}/INDEX.md`
  const absolutePath = join(repositoryRoot, path)
  if (!existsSync(absolutePath) && documents.length === 0) return []
  if (existsSync(absolutePath) && readText(absolutePath) === renderIndex(kind, documents)) return []
  return [structureFinding('stale-index', path, 'The index does not match the documents. Run `npm run whatwhy:index`.')]
}

/** @param {DocumentKind} kind @param {SpecDocument[]} documents */
function renderIndex(kind, documents) {
  const cell = (/** @type {string | undefined} */ value) => (value ?? '').replaceAll('|', '\\|')
  const rows = documents.map(({ id, fileName, frontmatter }) => `| [${id}](${fileName}) | ${cell(frontmatter.title)} | ${cell(frontmatter.status)} | ${cell(frontmatter.date)} |`)
  return [
    '<!-- Generated by `npm run whatwhy:index`. Do not edit by hand. -->',
    `# ${DOCUMENT_KINDS[kind].prefix} index`,
    '',
    '| ID | Title | Status | Date |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

// === IMMUTABILITY RULE ===

/** An ADR that left `proposed` before the base keeps its body; only its status may move on. ADRs added by this change stay editable for review. @param {string} repositoryRoot @param {ChangeSet} changeSet @returns {Finding[]} */
function checkImmutability(repositoryRoot, changeSet) {
  if (!changeSet.base) return []
  /** @type {Finding[]} */
  const findings = []
  const report = (/** @type {string} */ code, /** @type {string} */ file, /** @type {string} */ message) => findings.push({ rule: 'immutability', code, file, message })

  for (const path of changeSet.changedFiles.filter((file) => isSpecDocumentPath(file, 'adr'))) {
    const textAtBase = git(repositoryRoot, ['show', `${changeSet.base}:${path}`])
    const before = textAtBase === null ? null : parseDocument(textAtBase)
    if (!before || before.frontmatter.status === 'proposed') continue
    const id = before.frontmatter.id

    if (!existsSync(join(repositoryRoot, path))) {
      report('frozen-adr-removed', path, `${id} is ${before.frontmatter.status} and cannot be deleted or renamed. Restore it; supersede it with a new ADR instead.`)
      continue
    }
    const after = parseDocument(readText(join(repositoryRoot, path)))
    if (!after) continue // the structure rule reports unparseable files

    const keys = new Set([...Object.keys(before.frontmatter), ...Object.keys(after.frontmatter)])
    const editedKeys = [...keys].filter((key) => !['status', 'superseded-by'].includes(key) && before.frontmatter[key] !== after.frontmatter[key])
    if (before.body.trimEnd() !== after.body.trimEnd() || editedKeys.length > 0) {
      const what = editedKeys.length > 0 ? `frontmatter (${editedKeys.join(', ')})` : 'body'
      report('frozen-adr-edited', path, `${id} is ${before.frontmatter.status}, so its ${what} is frozen. Revert the edit and write a new ADR with \`supersedes: ${id}\`.`)
    }
    const from = before.frontmatter.status
    const to = after.frontmatter.status
    if (from !== to && !(from === 'accepted' && ['superseded', 'deprecated'].includes(to))) {
      report('invalid-status-transition', path, `${id} cannot go from ${from} to ${to}. Only accepted → superseded or deprecated is allowed.`)
    }
  }
  return findings
}

// === TRACEABILITY RULE ===

/** @param {SpecDocument[]} documents @param {ChangeSet} changeSet @returns {Finding[]} */
function checkTraceability(documents, changeSet) {
  if (changeSet.changedFiles.length === 0) return []
  const knownIds = new Set(documents.map((document) => document.id))
  const referencedIds = [...new Set([...changeSet.text.matchAll(SPEC_REFERENCE)].map((match) => `${match[1].toUpperCase()}-${match[2]}`))]
  const unknownIds = referencedIds.filter((id) => !knownIds.has(id))
  if (unknownIds.length > 0) {
    return [{ rule: 'traceability', code: 'unknown-spec-reference', message: `The branch, commits or pull request mention ${unknownIds.join(', ')}, which does not exist. See docs/adr/INDEX.md and docs/prd/INDEX.md.` }]
  }
  const isJustified = referencedIds.length > 0 || /\bno-spec:\s*\S/i.test(changeSet.text) || changeSet.changedFiles.some((file) => isSpecDocumentPath(file))
  if (isJustified) return []
  return [{ rule: 'traceability', code: 'missing-spec-reference', message: 'This change references no PRD or ADR. Mention an ID (e.g. PRD-0001) in the branch name, a commit message or the pull request, or write `no-spec: <reason>`.' }]
}

// === ARCHITECTURE RULE ===

/** @param {Configuration} configuration @param {ChangeSet} changeSet @returns {Finding[]} */
function checkArchitecture(configuration, changeSet) {
  const patterns = configuration.architecturalPaths.map(globToRegExp)
  const architecturalFiles = changeSet.changedFiles.filter((file) => patterns.some((pattern) => pattern.test(file)))
  if (architecturalFiles.length === 0) return []
  const isJustified = changeSet.changedFiles.some((file) => isSpecDocumentPath(file, 'adr')) || /\bno-adr:\s*\S/i.test(changeSet.text)
  if (isJustified) return []
  return [{ rule: 'architecture', code: 'architectural-change-without-adr', message: `Architectural paths changed (${architecturalFiles.join(', ')}) with no ADR in the same change. Add one from docs/adr/TEMPLATE.md, or write \`no-adr: <reason>\` in a commit message or the pull request.` }]
}

// === CHANGE SET ===

/** The change under review: the working tree compared with where the branch left the base branch. @param {string} repositoryRoot @param {Configuration} configuration @param {CheckOptions} options @returns {ChangeSet} */
function readChangeSet(repositoryRoot, configuration, options) {
  const hasCommits = git(repositoryRoot, ['rev-parse', '--verify', 'HEAD']) !== null
  const base = hasCommits ? resolveBase(repositoryRoot, configuration, options) : null
  const untrackedFiles = lines(git(repositoryRoot, ['ls-files', '--others', '--exclude-standard']))
  const changedFiles = base
    ? [...lines(git(repositoryRoot, ['diff', '--name-only', '--no-renames', base])), ...untrackedFiles]
    : [...lines(git(repositoryRoot, ['ls-files'])), ...untrackedFiles]
  const commitMessage = options.messageFile ? readText(options.messageFile).split('\n').filter((line) => !line.startsWith('#')).join('\n') : ''
  const text = [
    git(repositoryRoot, ['branch', '--show-current']),
    base ? git(repositoryRoot, ['log', '--format=%B', `${base}..HEAD`]) : '',
    options.pullRequestText,
    commitMessage,
  ].join('\n')
  return { base, changedFiles, text }
}

/** @param {string} repositoryRoot @param {Configuration} configuration @param {CheckOptions} options @returns {string | null} */
function resolveBase(repositoryRoot, configuration, options) {
  const mergeBase = (/** @type {string} */ ref) => git(repositoryRoot, ['merge-base', 'HEAD', ref])
  if (!options.base) return mergeBase(`origin/${configuration.baseBranch}`) ?? mergeBase(configuration.baseBranch)
  const base = mergeBase(options.base)
  if (!base) throw new Error(`--base ${options.base} shares no history with HEAD. Expected a fetched ref; in CI, check out with fetch-depth: 0.`)
  return base
}

// === HELPERS ===

/** @param {string} repositoryRoot @returns {Configuration} */
function loadConfiguration(repositoryRoot) {
  const path = join(repositoryRoot, 'whatwhy.config.json')
  const overrides = existsSync(path) ? JSON.parse(readText(path)) : {}
  const configuration = { ...DEFAULT_CONFIGURATION, ...overrides, rules: { ...DEFAULT_CONFIGURATION.rules, ...overrides.rules } }
  for (const [rule, severity] of Object.entries(configuration.rules)) {
    if (!(rule in DEFAULT_CONFIGURATION.rules) || !['error', 'warn', 'off'].includes(severity)) {
      throw new Error(`whatwhy.config.json: rules.${rule} is "${severity}". Expected one of ${Object.keys(DEFAULT_CONFIGURATION.rules).join(', ')} set to error, warn or off.`)
    }
  }
  return configuration
}

/** Splits a document into flat `key: value` frontmatter and body. Null when there is no valid frontmatter. @param {string} text @returns {ParsedDocument | null} */
function parseDocument(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replaceAll('\r\n', '\n'))
  if (!match) return null
  /** @type {Record<string, string>} */
  const frontmatter = {}
  for (const line of match[1].split('\n').filter((candidate) => candidate.trim() && !candidate.trim().startsWith('#'))) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) return null
    frontmatter[pair[1]] = pair[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return { frontmatter, body: match[2] }
}

/** @param {string} path @param {DocumentKind} [kind] any kind when omitted */
function isSpecDocumentPath(path, kind) {
  const kinds = kind ? [DOCUMENT_KINDS[kind]] : Object.values(DOCUMENT_KINDS)
  return kinds.some(({ directory }) => path.startsWith(`${directory}/`) && DOCUMENT_FILE_NAME.test(path.slice(directory.length + 1)))
}

/** Supports `*`, `?` and `**`. A `**` followed by a slash also matches zero directories. @param {string} glob */
function globToRegExp(glob) {
  const tokens = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' }
  const pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (token) => tokens[/** @type {keyof typeof tokens} */ (token)])
  return new RegExp(`^${pattern}$`)
}

/** @returns {Finding} */
function structureFinding(/** @type {string} */ code, /** @type {string} */ file, /** @type {string} */ message) {
  return { rule: 'structure', code, file, message }
}

/** Runs git and returns stdout, or null when the command fails. @param {string} repositoryRoot @param {string[]} gitArguments */
function git(repositoryRoot, gitArguments) {
  try {
    return execFileSync('git', gitArguments, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd()
  } catch {
    return null
  }
}

const lines = (/** @type {string | null} */ output) => (output ? output.split('\n').filter(Boolean) : [])
const readText = (/** @type {string} */ path) => readFileSync(path, 'utf8')

// === COMMAND LINE ===

function main() {
  const { values } = parseArgs({
    options: {
      'write-index': { type: 'boolean' },
      json: { type: 'boolean' },
      base: { type: 'string' },
      'message-file': { type: 'string' },
    },
  })
  const repositoryRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']) ?? process.cwd()
  if (values['write-index']) {
    for (const path of writeIndexes(repositoryRoot)) console.log(`wrote ${path}`)
    return
  }
  const findings = runChecks(repositoryRoot, { base: values.base, messageFile: values['message-file'], pullRequestText: process.env.WHATWHY_PR_TEXT })
  const errorCount = findings.filter((finding) => finding.severity === 'error').length
  if (values.json) {
    console.log(JSON.stringify({ ok: errorCount === 0, findings }, null, 2))
  } else {
    for (const { severity, rule, code, file, message } of findings) {
      console.error(`${severity === 'error' ? '✖ error' : '⚠ warn '}  ${rule}/${code}${file ? `  ${file}` : ''}\n    ${message}`)
      if (process.env.GITHUB_ACTIONS) console.log(`::${severity === 'error' ? 'error' : 'warning'} ${file ? `file=${file},` : ''}title=whatwhy ${rule}/${code}::${message}`)
    }
    console.error(`whatwhy: ${errorCount} error(s), ${findings.length - errorCount} warning(s)`)
  }
  if (errorCount > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`whatwhy could not run: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 2
  }
}
