import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

// Execute production TypeScript, real Zod schemas, and real permission helpers.
// Query hooks expose their configuration through a React boundary substitute;
// API calls stop at a recording transport. These are unit checks, not a claim
// that database-backed application flows have passed.
function loadSource(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('.')) throw new Error(`Unconfigured source dependency: ${name}`)
    return require(name)
  }, module, module.exports)
  return module.exports
}

const participantSchema = loadSource('features/participants/schema.ts').participantFormSchema
const registrationSchema = loadSource('features/registrations/schema.ts').registrationFormSchema
const policies = loadSource('features/registrations/policies.ts')
const taskTypes = loadSource('features/tasks/types.ts')
const taskSchema = loadSource('features/tasks/schema.ts', { './types': taskTypes })
const participantId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const validTask = () => ({ title: '  Prepare the venue  ', description: '  Collect keys  ', priority: 'high', due_at: '2027-01-05T09:30' })
const registration = (changes = {}) => ({
  id: 'registration-fixture', event_id: 'event-fixture', participant_id: participantId,
  status: 'registered', attended_at: null, fee_required: false, payment_status: null,
  created_at: '2027-01-01T10:00:00Z', ...changes,
})

function apiHarness() {
  const calls = []
  let result
  const api = { apiRequest: async (path, options = {}) => { calls.push({ path, options }); return result } }
  const query = { useQuery: options => options }
  return {
    calls,
    respond(value) { result = value },
    participants: loadSource('features/participants/queries.ts', { '../../services/api': api, '@tanstack/react-query': query }),
    registrations: loadSource('features/registrations/queries.ts', { '../../services/api': api, '@tanstack/react-query': query }),
    tasks: loadSource('features/tasks/api.ts', { '../../services/api': api }),
  }
}

test('participant names are trimmed before submission and accept the backend maximum', () => {
  assert.deepEqual(participantSchema.parse({ full_name: '  Alex Example  ' }), { full_name: 'Alex Example' })
  assert.equal(participantSchema.safeParse({ full_name: 'x'.repeat(150) }).success, true)
})

test('participant names reject empty, whitespace, and excessive text', () => {
  for (const full_name of ['', '  \t ', 'x'.repeat(151)]) {
    assert.equal(participantSchema.safeParse({ full_name }).success, false)
  }
})

test('registration form requires an existing participant UUID and a boolean fee flag', () => {
  assert.deepEqual(registrationSchema.parse({ participant_id: participantId, fee_required: true }), {
    participant_id: participantId, fee_required: true,
  })
  for (const values of [
    { participant_id: '', fee_required: false }, { participant_id: 'someone', fee_required: false },
    { participant_id: participantId, fee_required: 'false' },
  ]) assert.equal(registrationSchema.safeParse(values).success, false)
})

test('only planned and active events accept new registrations', () => {
  for (const status of ['planned', 'active']) assert.equal(policies.acceptsRegistrations({ status, archived_at: null }), true)
  for (const status of ['completed', 'cancelled']) assert.equal(policies.acceptsRegistrations({ status, archived_at: null }), false)
})

test('archived events do not accept registration or attendance', () => {
  const event = { status: 'active', archived_at: '2027-01-01T10:00:00Z' }
  assert.equal(policies.acceptsRegistrations(event), false)
  assert.equal(policies.canMarkAttendance(event, registration()), false)
})

test('attendance requires an active event and a current registration without earlier attendance', () => {
  const active = { status: 'active', archived_at: null }
  assert.equal(policies.canMarkAttendance(active, registration()), true)
  for (const status of ['planned', 'completed', 'cancelled']) {
    assert.equal(policies.canMarkAttendance({ ...active, status }, registration()), false)
  }
  assert.equal(policies.canMarkAttendance(active, registration({ status: 'cancelled' })), false)
  assert.equal(policies.canMarkAttendance(active, registration({ attended_at: '2027-01-05T09:00:00Z' })), false)
})

test('registration cancellation is available only before attendance for a current registration', () => {
  assert.equal(policies.canCancelRegistration(registration()), true)
  assert.equal(policies.canCancelRegistration(registration({ status: 'cancelled' })), false)
  assert.equal(policies.canCancelRegistration(registration({ attended_at: '2027-01-05T09:00:00Z' })), false)
})

test('participant eligibility excludes both current and cancelled registrations permanently', () => {
  const participants = [{ id: 'current' }, { id: 'cancelled' }, { id: 'available' }]
  const registrations = [registration({ participant_id: 'current' }), registration({ participant_id: 'cancelled', status: 'cancelled' })]
  assert.deepEqual(policies.availableParticipants(participants, registrations), [{ id: 'available' }])
  assert.equal(participants.length, 3)
  assert.equal(registrations.length, 2)
})

test('task titles are trimmed, required, and limited to the backend maximum', () => {
  assert.equal(taskSchema.taskFormSchema.parse(validTask()).title, 'Prepare the venue')
  assert.equal(taskSchema.taskFormSchema.safeParse({ ...validTask(), title: 'x'.repeat(150) }).success, true)
  for (const title of ['', '   ', 'x'.repeat(151)]) {
    assert.equal(taskSchema.taskFormSchema.safeParse({ ...validTask(), title }).success, false)
  }
})

test('task priorities match the backend enum and reject unsupported values', () => {
  assert.deepEqual(taskTypes.taskPriorities, ['low', 'medium', 'high'])
  for (const priority of taskTypes.taskPriorities) assert.equal(taskSchema.taskFormSchema.safeParse({ ...validTask(), priority }).success, true)
  assert.equal(taskSchema.taskFormSchema.safeParse({ ...validTask(), priority: 'urgent' }).success, false)
})

test('optional task dates accept local minute or second precision and reject invalid calendar dates', () => {
  for (const due_at of ['', '2027-01-05T09:30', '2027-01-05T09:30:41']) {
    assert.equal(taskSchema.taskFormSchema.safeParse({ ...validTask(), due_at }).success, true)
  }
  for (const due_at of ['2027-02-30T09:30', '2027-01-05T25:30', '2027-01-05', 'not-a-date']) {
    assert.equal(taskSchema.taskFormSchema.safeParse({ ...validTask(), due_at }).success, false)
  }
})

test('blank task description and due date serialize as null', () => {
  const values = taskSchema.taskFormSchema.parse({ ...validTask(), description: '   ', due_at: '' })
  assert.deepEqual(taskSchema.toTaskFields(values), { title: 'Prepare the venue', description: null, priority: 'high', due_at: null })
})

test('task payload uses timezone-aware ISO instants and trimmed description', () => {
  const values = taskSchema.taskFormSchema.parse({ ...validTask(), due_at: '2027-01-05T09:30:41' })
  const payload = taskSchema.toTaskFields(values)
  assert.equal(payload.due_at, new Date('2027-01-05T09:30:41').toISOString())
  assert.match(payload.due_at, /Z$/)
  assert.equal(payload.description, 'Collect keys')
})

test('new task defaults use medium priority and optional blank values', () => {
  assert.deepEqual(taskSchema.taskFormDefaults(), { title: '', description: '', priority: 'medium', due_at: '' })
})

test('editing defaults round-trip an existing due date without losing seconds', () => {
  const existing = { title: 'Existing task', description: null, priority: 'low', due_at: '2027-01-05T12:34:41Z' }
  const defaults = taskSchema.taskFormDefaults(existing)
  const payload = taskSchema.toTaskFields(taskSchema.taskFormSchema.parse(defaults))
  assert.equal(payload.due_at, new Date(existing.due_at).toISOString())
  assert.equal(defaults.description, '')
  assert.match(defaults.due_at, /:41$/)
  assert.equal(taskSchema.taskFormDefaults({ ...existing, due_at: 'bad-date' }).due_at, '')
})

test('task assignment form accepts only a valid member UUID', () => {
  assert.deepEqual(taskSchema.taskAssignmentSchema.parse({ user_id: memberId }), { user_id: memberId })
  for (const user_id of ['', 'member-name', '123']) assert.equal(taskSchema.taskAssignmentSchema.safeParse({ user_id }).success, false)
})

test('task status labels preserve the existing backend status values', () => {
  assert.deepEqual(taskTypes.taskStatuses, ['todo', 'in_progress', 'done'])
  assert.equal(taskTypes.taskLabel('in_progress'), 'In progress')
  assert.equal(taskTypes.taskLabel('high'), 'High')
})

test('Owners and Admins can change status without being assigned', () => {
  for (const role of ['Owner', 'Admin']) assert.equal(taskTypes.canChangeTaskStatus(role, memberId, []), true)
})

test('other active member roles can change status only while assigned', () => {
  for (const role of ['Member', 'Treasurer', 'Logistics']) {
    assert.equal(taskTypes.canChangeTaskStatus(role, memberId, [{ user_id: memberId }]), true)
    assert.equal(taskTypes.canChangeTaskStatus(role, memberId, [{ user_id: participantId }]), false)
    assert.equal(taskTypes.canChangeTaskStatus(role, memberId, []), false)
  }
})

test('Viewers remain read-only even when assigned and incomplete membership does not allow updates', () => {
  assert.equal(taskTypes.canChangeTaskStatus('Viewer', memberId, [{ user_id: memberId }]), false)
  assert.equal(taskTypes.canChangeTaskStatus(undefined, memberId, []), false)
  assert.equal(taskTypes.canChangeTaskStatus('Owner', undefined, []), false)
})

test('task fetching uses the real event-scoped endpoint, forwards cancellation, and rejects mismatched records', async () => {
  const harness = apiHarness()
  const signal = new AbortController().signal
  harness.respond([{ id: 'task-fixture', event_id: 'event-fixture' }])
  assert.equal((await harness.tasks.fetchTasks('event-fixture', signal)).length, 1)
  assert.deepEqual(harness.calls[0], { path: '/api/v1/tasks?event_id=event-fixture', options: { signal } })
  harness.respond([{ event_id: 'different-event' }])
  await assert.rejects(harness.tasks.fetchTasks('event-fixture', signal), /does not belong to the selected event/)
})

test('task creation, edits, and status changes preserve API methods and payloads', async () => {
  const harness = apiHarness()
  const fields = taskSchema.toTaskFields(taskSchema.taskFormSchema.parse(validTask()))
  await harness.tasks.createTask({ event_id: 'event-fixture', ...fields })
  await harness.tasks.updateTask('task/fixture', fields)
  await harness.tasks.updateTaskStatus('task/fixture', 'in_progress')
  assert.deepEqual(harness.calls, [
    { path: '/api/v1/tasks', options: { method: 'POST', body: { event_id: 'event-fixture', ...fields } } },
    { path: '/api/v1/tasks/task%2Ffixture', options: { method: 'PATCH', body: fields } },
    { path: '/api/v1/tasks/task%2Ffixture/status', options: { method: 'PATCH', body: { status: 'in_progress' } } },
  ])
})

test('assignment fetching uses task scope and rejects another task in the response', async () => {
  const harness = apiHarness()
  const signal = new AbortController().signal
  harness.respond([{ task_id: 'task-fixture', user_id: memberId }])
  assert.equal((await harness.tasks.fetchTaskAssignments('task-fixture', signal))[0].user_id, memberId)
  assert.deepEqual(harness.calls[0], { path: '/api/v1/task-assignments?task_id=task-fixture', options: { signal } })
  harness.respond([{ task_id: 'different-task' }])
  await assert.rejects(harness.tasks.fetchTaskAssignments('task-fixture', signal), /does not belong to this task/)
})

test('assignment create and removal use the supported API contracts', async () => {
  const harness = apiHarness()
  await harness.tasks.assignTask('task-fixture', memberId)
  await harness.tasks.removeTaskAssignment('assignment/fixture')
  assert.deepEqual(harness.calls, [
    { path: '/api/v1/task-assignments', options: { method: 'POST', body: { task_id: 'task-fixture', user_id: memberId } } },
    { path: '/api/v1/task-assignments/assignment%2Ffixture', options: { method: 'DELETE' } },
  ])
})

test('participant queries isolate organization keys, disable absent scope, and reject another tenant', async () => {
  const harness = apiHarness()
  assert.notDeepEqual(harness.participants.participantKeys.list('org-a'), harness.participants.participantKeys.list('org-b'))
  assert.equal(harness.participants.useParticipants(undefined).enabled, false)
  const query = harness.participants.useParticipants('org-a')
  harness.respond([{ id: participantId, organization_id: 'org-a' }])
  const signal = new AbortController().signal
  assert.equal((await query.queryFn({ signal }))[0].id, participantId)
  assert.deepEqual(harness.calls[0], { path: '/api/v1/participants?organization_id=org-a', options: { signal } })
  harness.respond([{ organization_id: 'org-b' }])
  await assert.rejects(query.queryFn({ signal }), /does not match your selected organization/)
  const payload = { organization_id: 'org-a', full_name: 'Synthetic participant' }
  await harness.participants.createParticipant(payload)
  assert.deepEqual(harness.calls.at(-1), { path: '/api/v1/participants', options: { method: 'POST', body: payload } })
})

test('registration mutations use real endpoints and omit invented attendance or cancellation payloads', async () => {
  const harness = apiHarness()
  const payload = { event_id: 'event-fixture', participant_id: participantId, fee_required: true }
  await harness.registrations.createRegistration(payload)
  await harness.registrations.markRegistrationAttendance('registration/fixture')
  await harness.registrations.cancelRegistration('registration/fixture')
  assert.deepEqual(harness.calls, [
    { path: '/api/v1/registrations', options: { method: 'POST', body: payload } },
    { path: '/api/v1/registrations/registration%2Ffixture/attendance', options: { method: 'PATCH' } },
    { path: '/api/v1/registrations/registration%2Ffixture/cancel', options: { method: 'PATCH' } },
  ])
})

test('registration queries require both scopes and reject records from a different event', async () => {
  const harness = apiHarness()
  assert.equal(harness.registrations.useRegistrations(undefined, 'event-a').enabled, false)
  assert.equal(harness.registrations.useRegistrations('org-a', undefined).enabled, false)
  assert.notDeepEqual(harness.registrations.registrationKeys.event('org-a', 'event-a'), harness.registrations.registrationKeys.event('org-b', 'event-a'))
  const query = harness.registrations.useRegistrations('org-a', 'event-a')
  const signal = new AbortController().signal
  harness.respond([registration({ event_id: 'event-a' })])
  assert.equal((await query.queryFn({ signal })).length, 1)
  assert.deepEqual(harness.calls[0], { path: '/api/v1/registrations?event_id=event-a', options: { signal } })
  harness.respond([registration({ event_id: 'event-b' })])
  await assert.rejects(query.queryFn({ signal }), /does not match the selected event/)
})

test('task and assignment query keys keep organizations, events, and tasks separate', () => {
  const queries = loadSource('features/tasks/queries.ts', {
    '@tanstack/react-query': { useQuery: options => options }, '../../services/api': {},
    '../auth/useAuth': {}, '../organizations/useOrganization': {}, './api': {},
  })
  assert.notDeepEqual(queries.taskKeys.event('org-a', 'event-a'), queries.taskKeys.event('org-b', 'event-a'))
  assert.notDeepEqual(queries.taskKeys.event('org-a', 'event-a'), queries.taskKeys.event('org-a', 'event-b'))
  assert.notDeepEqual(queries.taskKeys.assignments('org-a', 'event-a', 'task-a'), queries.taskKeys.assignments('org-a', 'event-a', 'task-b'))
  assert.equal(queries.useTasks('', 'event-a').enabled, false)
  assert.equal(queries.useTasks('org-a', 'event-a', false).enabled, false)
  assert.equal(queries.useTaskAssignments('org-a', 'event-a', '').enabled, false)
})
