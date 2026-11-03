import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// Execute production source, replacing only Vite environment and network/session boundaries.
function source(relativePath, dependencies = {}, bindings = {}) {
  const input = readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8').replaceAll('import.meta.env', 'viteEnv')
  const { outputText } = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  const dependency = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('.')) throw new Error(`Unexpected test dependency: ${name}`)
    return require(name)
  }
  new Function('require', 'module', 'exports', ...Object.keys(bindings), outputText)(dependency, module, module.exports, ...Object.values(bindings))
  return module.exports
}

const directory = 'features/participants/import/'
const policies = source(`${directory}policies.ts`)
const organizationId = randomUUID()
const eventId = randomUUID()
const participantId = randomUUID()
const valid = (row_number = 2, full_name = 'Example participant') => ({ row_number, full_name, errors: [], duplicate_of_row: null, existing_participant_id: null })
const selection = () => ({ organization_id: organizationId, rows: [{ row_number: 2, full_name: 'Example participant' }], event_id: null, fee_required: false })
const request = () => ({ ...selection(), idempotency_key: randomUUID() })
const preview = () => ({ organization_id: organizationId, filename: 'participants.csv', rows: [valid()], total_rows: 1, valid_rows: 1, invalid_rows: 0 })
const result = payload => ({
  operation_id: randomUUID(), idempotency_key: payload.idempotency_key, organization_id: organizationId, event_id: payload.event_id,
  created_count: 1, registered_count: 0, replayed: false,
  participants: [{ id: participantId, organization_id: organizationId, full_name: 'Example participant', created_at: '2027-01-01T12:00:00Z' }], registrations: [],
})

function importApi(responder) {
  return source(`${directory}api.ts`, { '../../../services/api': { apiRequest: responder }, './policies': policies })
}

test('CSV/XLSX file validation accepts case-insensitive extensions and the exact size limit', () => {
  for (const name of ['participants.csv', 'participants.CSV', 'participants.xlsx', 'participants.XLSX']) {
    assert.equal(policies.validateImportFile({ name, size: policies.maximumImportBytes }), null)
  }
})

test('file validation rejects unsupported, empty, and oversized files before upload', () => {
  for (const name of ['participants.xls', 'participants.txt', 'participants.csv.exe', 'participants']) {
    assert.match(policies.validateImportFile({ name, size: 100 }), /CSV or XLSX/)
  }
  assert.match(policies.validateImportFile({ name: 'participants.csv', size: 0 }), /empty/)
  assert.match(policies.validateImportFile({ name: 'participants.xlsx', size: policies.maximumImportBytes + 1 }), /5 MiB/)
})

test('invalid rows and either duplicate type are never selectable, including missing server error text', () => {
  assert.equal(policies.canSelectImportRow(valid()), true)
  for (const row of [
    { ...valid(), errors: ['Name is invalid'] },
    { ...valid(), duplicate_of_row: 2 },
    { ...valid(), existing_participant_id: participantId },
    valid(2, '   '), valid(2, 'x'.repeat(151)),
  ]) assert.equal(policies.canSelectImportRow(row), false)
  assert.match(policies.importRowIssues({ ...valid(3), duplicate_of_row: 2 }).join(' '), /row 2/)
})

test('selection explicitly skips invalid and unchecked rows while preserving server names and original row numbers', () => {
  const rows = [valid(8, 'Name  with  spaces'), { ...valid(4), errors: ['Invalid row'] }, valid(2, 'Other name'), valid(3)]
  assert.deepEqual(policies.selectedImportRows(rows, new Set([8, 4, 2, 999])), [
    { row_number: 2, full_name: 'Other name' }, { row_number: 8, full_name: 'Name  with  spaces' },
  ])
  assert.deepEqual(policies.selectedImportRows(rows, new Set()), [])
  assert.equal(rows[0].row_number, 8, 'Selecting must not mutate preview ordering')
})

test('payload identity is stable across row order and changes with any submitted value', () => {
  const original = { ...selection(), rows: [{ row_number: 2, full_name: 'First' }, { row_number: 3, full_name: 'Second' }] }
  const identity = policies.importSelectionIdentity(original)
  assert.equal(policies.importSelectionIdentity({ ...original, rows: [...original.rows].reverse() }), identity)
  for (const changed of [
    { ...original, organization_id: randomUUID() }, { ...original, event_id: eventId }, { ...original, fee_required: true },
    { ...original, rows: [{ row_number: 2, full_name: 'Changed' }] }, { ...original, rows: [{ row_number: 4, full_name: 'First' }, original.rows[1]] },
  ]) assert.notEqual(policies.importSelectionIdentity(changed), identity)
})

test('rich apply errors map explicit and indexed errors back to file row numbers', () => {
  const rows = [{ row_number: 2, full_name: 'First' }, { row_number: 9, full_name: 'Second' }]
  assert.deepEqual(policies.readImportIssues([
    { loc: ['body', 'rows', 0], msg: 'Name exists', row_number: 7 },
    { loc: ['body', 'rows', 1], msg: 'Name too long' }, { loc: ['body', 'event_id'], msg: 'Event unavailable' }, null, { msg: 42 },
  ], rows), [{ row_number: 7, message: 'Name exists' }, { row_number: 9, message: 'Name too long' }, { row_number: null, message: 'Event unavailable' }])
  assert.deepEqual(policies.readImportIssues('Invalid import', rows), [])
})

test('preview uploads multipart to the real endpoint and verifies organization, row counts, and unique row numbers', async () => {
  const file = new File(['full_name\nExample participant'], 'participants.csv', { type: 'text/csv' })
  const controller = new AbortController()
  const api = importApi(async (path, options) => {
    assert.equal(path, '/api/v1/participants/import/preview')
    assert.equal(options.method, 'POST')
    assert.equal(options.signal, controller.signal)
    assert.ok(options.body instanceof FormData)
    assert.equal(options.body.get('organization_id'), organizationId)
    assert.equal(options.body.get('file').name, file.name)
    return preview()
  })
  assert.equal((await api.previewParticipantImport(organizationId, file, controller.signal)).rows[0].row_number, 2)
  for (const invalid of [
    { ...preview(), organization_id: randomUUID() }, { ...preview(), total_rows: 2 },
    { ...preview(), rows: [valid(), valid()], total_rows: 2, valid_rows: 2 },
  ]) await assert.rejects(importApi(async () => invalid).previewParticipantImport(organizationId, file, controller.signal), /could not be verified/)
})

test('apply preserves the confirmed retry key and rejects inconsistent or cross-organization success data', async () => {
  const payload = request()
  const api = importApi(async (path, options) => {
    assert.equal(path, '/api/v1/participants/import')
    assert.equal(options.method, 'POST')
    assert.deepEqual(options.body, payload)
    return { ...result(payload), replayed: true }
  })
  assert.equal((await api.applyParticipantImport(payload)).replayed, true)
  for (const invalid of [
    { ...result(payload), idempotency_key: randomUUID() }, { ...result(payload), event_id: eventId },
    { ...result(payload), participants: [{ ...result(payload).participants[0], organization_id: randomUUID() }] },
    { ...result(payload), created_count: 2 },
  ]) await assert.rejects(importApi(async () => invalid).applyParticipantImport(payload), /Retry the unchanged import/)
})

test('apply validates optional event registrations against the returned newly created participants', async () => {
  const payload = { ...request(), event_id: eventId, fee_required: true }
  const registration = { id: randomUUID(), event_id: eventId, participant_id: participantId, status: 'registered', attended_at: null, fee_required: true, payment_status: 'unpaid', created_at: '2027-01-01T12:00:00Z' }
  const response = { ...result(payload), registered_count: 1, registrations: [registration] }
  assert.equal((await importApi(async () => response).applyParticipantImport(payload)).registered_count, 1)
  await assert.rejects(importApi(async () => ({ ...response, registrations: [{ ...registration, participant_id: randomUUID() }] })).applyParticipantImport(payload), /could not be verified/)
})

test('shared API sends FormData with bearer authentication and lets the browser choose its multipart boundary', async () => {
  const body = new FormData()
  body.set('organization_id', organizationId)
  body.set('file', new File(['full_name'], 'template.csv'))
  const controller = new AbortController()
  const api = source('services/api.ts', { './session': { getSession: () => ({ token: 'unit-test-token' }), setSessionToken: () => assert.fail('Unexpected session reset') } }, {
    viteEnv: {}, fetch: async (url, options) => {
      assert.equal(url, '/backend/api/v1/participants/import/preview')
      assert.equal(options.headers.Authorization, 'Bearer unit-test-token')
      assert.equal(options.headers['Content-Type'], undefined)
      assert.equal(options.body, body)
      assert.equal(options.signal, controller.signal)
      assert.equal(options.credentials, 'omit')
      return new Response(JSON.stringify(preview()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  await api.apiRequest('/api/v1/participants/import/preview', { method: 'POST', body, signal: controller.signal })
})
