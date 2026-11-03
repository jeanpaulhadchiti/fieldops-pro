import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// Exercise production selection, policy, and receipt code. Only the transport
// boundary is substituted; no database-backed flow is claimed by these units.
function loadSource(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('.')) throw new Error(`Unconfigured source dependency: ${name}`)
    return require(name)
  }, module, module.exports)
  return module.exports
}

const selection = loadSource('features/registrations/BulkRegistrationSelection.ts')
const policies = loadSource('features/registrations/policies.ts')
const eventId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const key = '33333333-3333-4333-8333-333333333333'
const participantId = index => `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`
const participant = index => ({ id: participantId(index), organization_id: organizationId, full_name: `Participant ${index}`, created_at: '2027-01-01T10:00:00Z' })

class BoundaryApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

function receiptFor(request, changes = {}) {
  return {
    operation_id: '55555555-5555-4555-8555-555555555555',
    idempotency_key: request.idempotency_key,
    event_id: request.event_id,
    created_count: request.participant_ids.length,
    replayed: false,
    registrations: request.participant_ids.map((id, index) => ({
      id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
      event_id: request.event_id, participant_id: id, status: 'registered',
      attended_at: null, fee_required: request.fee_required,
      payment_status: request.fee_required ? 'unpaid' : null,
      created_at: '2027-01-01T10:00:00Z',
    })),
    ...changes,
  }
}

function apiHarness() {
  const calls = []
  let response
  let failure
  const api = loadSource('features/registrations/BulkRegistrationApi.ts', {
    '../../services/api': {
      ApiError: BoundaryApiError,
      apiRequest: async (path, options) => {
        calls.push({ path, options })
        if (failure) throw failure
        return response
      },
    },
  })
  return { ...api, calls, respond(value) { response = value; failure = null }, fail(error) { failure = error } }
}

for (const count of [1, 10, 100]) {
  test(`bulk API sends one atomic ${count}-participant request with exact existing fields`, async () => {
    const ids = Array.from({ length: count }, (_, index) => participantId(index))
    const request = selection.prepareBulkRequest(eventId, ids, true, null, () => key)
    const harness = apiHarness()
    harness.respond(receiptFor(request))
    const result = await harness.createBulkRegistration(request)
    assert.equal(result.created_count, count)
    assert.equal(harness.calls.length, 1)
    assert.deepEqual(harness.calls[0], {
      path: '/api/v1/registrations/bulk', options: { method: 'POST', body: {
        event_id: eventId, participant_ids: ids, fee_required: true, idempotency_key: key,
      } },
    })
    assert.equal(Object.hasOwn(harness.calls[0].options.body, 'payment_status'), false)
  })
}

test('eligible participants exclude every existing registration, including cancelled ones', () => {
  const participants = [participant(1), participant(2), participant(3)]
  const registrations = [
    { participant_id: participantId(1), status: 'registered' },
    { participant_id: participantId(2), status: 'cancelled' },
  ]
  assert.deepEqual(policies.availableParticipants(participants, registrations), [participant(3)])
})

test('search filters names without changing the full eligible selection source', () => {
  const eligible = [participant(1), participant(2), participant(3)]
  assert.deepEqual(selection.filterBulkParticipants(eligible, '  PARTICIPANT 2 '), [participant(2)])
  assert.equal(eligible.length, 3)
  // Select All uses the complete eligible list, regardless of the search result.
  const selected = eligible.map(person => person.id)
  assert.equal(selected.length, 3)
  assert.equal(selection.bulkSelectionProblem(selected, new Set(selected), null), null)
})

test('selection validation rejects empty, duplicate, and ineligible IDs', () => {
  const ids = [participantId(1), participantId(2)]
  const eligible = new Set(ids)
  assert.match(selection.bulkSelectionProblem([], eligible, null), /at least one/)
  assert.match(selection.bulkSelectionProblem([ids[0], ids[0]], eligible, null), /only once/)
  assert.match(selection.bulkSelectionProblem([participantId(3)], eligible, null), /no longer eligible/)
  assert.equal(selection.bulkSelectionProblem(ids, eligible, null), null)
})

test('capacity uses current registered count, handles unlimited events, and prevents oversized selections', () => {
  assert.equal(selection.bulkRemainingPlaces(null, 100), null)
  assert.equal(selection.bulkRemainingPlaces(20, 18), 2)
  assert.equal(selection.bulkRemainingPlaces(20, 21), 0)
  const ids = [participantId(1), participantId(2)]
  assert.equal(selection.bulkSelectionProblem(ids, new Set(ids), 2), null)
  assert.match(selection.bulkSelectionProblem(ids, new Set(ids), 1), /Only 1 place remains/)
  assert.match(selection.bulkSelectionProblem([ids[0]], new Set(ids), 0), /Only 0 places remain/)
})

test('the frontend permits the 1000 participant maximum and rejects 1001 atomically', () => {
  const ids = Array.from({ length: 1001 }, (_, index) => participantId(index))
  assert.equal(selection.maximumBulkParticipants, 1000)
  assert.equal(selection.bulkSelectionProblem(ids.slice(0, 1000), new Set(ids), null), null)
  assert.match(selection.bulkSelectionProblem(ids, new Set(ids), null), /up to 1,000/)
})

test('identical selection order and fee reuse the request key without mutating the selection', () => {
  const ids = [participantId(2), participantId(1)]
  const first = selection.prepareBulkRequest(eventId, ids, false, null, () => key)
  const retry = selection.prepareBulkRequest(eventId, [...ids].reverse(), false, first, () => { throw new Error('A retry must not create another key') })
  assert.equal(retry.idempotency_key, key)
  assert.deepEqual(retry.participant_ids, [...ids].sort())
  assert.deepEqual(ids, [participantId(2), participantId(1)])
  assert.notEqual(retry.participant_ids, first.participant_ids)
})

test('changed selection, fee, event, or cleared successful attempt creates a new request key', () => {
  const ids = [participantId(1), participantId(2)]
  const first = selection.prepareBulkRequest(eventId, ids, false, null, () => key)
  const newKey = '77777777-7777-4777-8777-777777777777'
  for (const [selectedEvent, selectedIds, fee, previous] of [
    [eventId, [ids[0]], false, first], [eventId, ids, true, first],
    [organizationId, ids, false, first], [eventId, ids, false, null],
  ]) {
    assert.equal(selection.prepareBulkRequest(selectedEvent, selectedIds, fee, previous, () => newKey).idempotency_key, newKey)
  }
})

test('network and server failures remain uncertain while deterministic validation errors do not', () => {
  for (const error of [new Error('Network response lost'), new BoundaryApiError('Unavailable', 503), new BoundaryApiError('Invalid receipt', 502), new BoundaryApiError('Timeout', 408)]) {
    assert.equal(selection.bulkOutcomeIsUncertain(error), true)
  }
  for (const error of [new BoundaryApiError('Conflict', 409), new BoundaryApiError('Invalid', 422), new BoundaryApiError('Permission denied', 403), new selection.BulkRegistrationValidationError('Capacity changed')]) {
    assert.equal(selection.bulkOutcomeIsUncertain(error), false)
  }
})

test('an uncertain request replays its original snapshot after current eligibility and capacity change', async () => {
  const request = selection.prepareBulkRequest(eventId, [participantId(1), participantId(2)], true, null, () => key)
  const snapshot = { request, participants: [participant(1), participant(2)] }
  const harness = apiHarness()
  harness.fail(new Error('Response lost after save'))
  await assert.rejects(harness.createBulkRegistration(snapshot.request), /Response lost/)
  const currentEligible = policies.availableParticipants(snapshot.participants, request.participant_ids.map(id => ({ participant_id: id, status: 'registered' })))
  assert.equal(currentEligible.length, 0)
  assert.equal(selection.bulkRemainingPlaces(2, 2), 0)
  harness.respond(receiptFor(snapshot.request, { replayed: true }))
  const replay = await harness.createBulkRegistration(snapshot.request)
  assert.equal(replay.replayed, true)
  assert.equal(replay.created_count, 2)
  assert.deepEqual(harness.calls[0].options.body, harness.calls[1].options.body)
  assert.equal(harness.calls[1].options.body.idempotency_key, key)
})

test('rich errors preserve affected participant IDs, zero-based indices, and readable messages', () => {
  assert.deepEqual(selection.bulkRegistrationIssues([
    { loc: ['body', 'participant_ids', 0], msg: 'Participant already has a registration for this event', type: 'value_error', participant_id: participantId(1) },
    { loc: ['body', 'participant_ids', 1], msg: 'Not enough capacity', type: 'value_error' },
    { loc: ['body', 'event_id'], msg: 'Event is closed', type: 'value_error' },
    null,
  ]), [
    { message: 'Participant already has a registration for this event', participantId: participantId(1), index: 0 },
    { message: 'Not enough capacity', participantId: undefined, index: 1 },
    { message: 'Event is closed', participantId: undefined, index: undefined },
  ])
  assert.deepEqual(selection.bulkRegistrationIssues('Permission denied'), [])
})

test('bulk receipt validation rejects mismatched event, key, count, participant set, fee, and malformed metadata', async () => {
  const request = selection.prepareBulkRequest(eventId, [participantId(1), participantId(2)], false, null, () => key)
  const harness = apiHarness()
  const good = receiptFor(request)
  for (const changes of [
    { event_id: organizationId }, { idempotency_key: 'wrong' }, { created_count: 1 },
    { operation_id: '' }, { replayed: undefined }, { registrations: null },
    { registrations: [good.registrations[0], good.registrations[0]] },
    { registrations: [good.registrations[0], { ...good.registrations[1], participant_id: participantId(3) }] },
    { registrations: [good.registrations[0], { ...good.registrations[1], fee_required: true }] },
    { registrations: [good.registrations[0], { ...good.registrations[1], event_id: organizationId }] },
  ]) {
    harness.respond({ ...good, ...changes })
    await assert.rejects(harness.createBulkRegistration(request), error => error.status === 502 && /matching registration receipt/.test(error.message))
  }
})
