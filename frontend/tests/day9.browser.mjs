/** Real browser -> Vite proxy -> FastAPI -> isolated PostgreSQL acceptance checks.
 * Requires FIELDOPS_TEST_DATABASE_URL and optional FIELDOPS_PLAYWRIGHT_MODULE.
 * Uses generated accounts exclusively in an explicitly named local test database.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { preview } from 'vite'

const databaseUrl = new URL(process.env.FIELDOPS_TEST_DATABASE_URL || 'missing:')
assert.equal(databaseUrl.protocol, 'postgresql+psycopg:')
assert.ok(['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) && databaseUrl.port)
assert.match(databaseUrl.pathname, /^\/fieldops_day9_test_[a-z0-9_]+$/)
assert.equal(databaseUrl.search, '')
const { chromium } = await import(process.env.FIELDOPS_PLAYWRIGHT_MODULE || 'playwright')
const frontendDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const backendDir = resolve(frontendDir, '../backend')
const python = process.env.FIELDOPS_TEST_PYTHON || resolve(backendDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const apiPort = Number(process.env.FIELDOPS_TEST_API_PORT || 8019)
const apiBase = `http://127.0.0.1:${apiPort}`
const server = spawn(python, ['-B', '-m', 'uvicorn', 'day9_server:create_app', '--factory', '--app-dir', 'tests', '--host', '127.0.0.1', '--port', String(apiPort), '--log-level', 'warning'], {
  cwd: backendDir, env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
})
// Drain server errors without emitting connection URLs or test credentials.
server.stderr.on('data', () => {})
let frontend
let browser
let failureScreenshotPage
const passes = []
const pass = label => { passes.push(label); console.log(`PASS ${label}`) }
const runId = randomUUID().slice(0, 8)
const runtimeErrors = []

async function request(path, { token, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
  })
  assert.equal(response.status, expected, `${method} ${path} HTTP status`)
  return response.status === 204 ? null : response.json()
}

async function account(role) {
  const values = { name: `Browser ${role} ${runId}`, email: `browser-${role}-${runId}@example.com`, password: 'A!' + randomUUID() + randomUUID() }
  const profile = await request('/auth/register', { method: 'POST', body: values, expected: 201 })
  const auth = await request('/auth/login', { method: 'POST', body: values })
  return { ...values, id: profile.id, token: auth.access_token }
}

try {
  let health
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { health = await request('/health'); break } catch { await new Promise(resolveWait => setTimeout(resolveWait, 200)) }
    if (server.exitCode !== null) throw new Error('Isolated test server exited before startup')
  }
  assert.equal(health?.test_database, databaseUrl.pathname.slice(1), 'Never write unless test database identity is verified')
  assert.equal(health?.database_type, 'postgresql')
  const owner = await account('Owner')
  const member = await account('Member')
  const viewer = await account('Viewer')
  const outsider = await account('Outsider')
  const org = await request('/organizations', { token: owner.token, method: 'POST', body: { name: `Field team ${runId}` }, expected: 201 })
  const secondOrg = await request('/organizations', { token: owner.token, method: 'POST', body: { name: `Second team ${runId}` }, expected: 201 })
  for (const user of [member, viewer]) await request(`/organizations/${org.id}/members`, { token: owner.token, method: 'POST', body: { email: user.email, role: user === member ? 'Member' : 'Viewer' }, expected: 201 })
  const event = await request('/api/v1/events', { token: owner.token, method: 'POST', body: { organization_id: org.id, title: `Live operations ${runId}`, description: 'Created only in an isolated PostgreSQL acceptance database.', location: 'Test training field', start_at: '2027-02-10T09:00:00+02:00', end_at: '2027-02-10T17:00:00+02:00', capacity: 20 }, expected: 201 })
  frontend = await preview({ root: frontendDir, preview: { host: '127.0.0.1', port: 5191, strictPort: true, proxy: { '/backend': { target: apiBase, changeOrigin: true, rewrite: path => path.replace(/^\/backend/, '') } } } })
  browser = await chromium.launch({ channel: process.env.FIELDOPS_BROWSER_CHANNEL || 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Beirut' })
  const page = await context.newPage()
  failureScreenshotPage = page
  page.on('pageerror', error => runtimeErrors.push(error.message))
  const base = 'http://127.0.0.1:5191'
  const heading = (name, scope = page) => scope.getByRole('heading', { name, exact: true })
  async function login(target, user) {
    await target.getByLabel('Email address').fill(user.email)
    await target.getByLabel('Password', { exact: true }).fill(user.password)
    await target.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  await page.goto(`${base}/events/${event.id}`)
  await heading('Welcome back').waitFor()
  await login(page, owner)
  await heading(event.title).waitFor()
  assert.equal(await page.getByLabel('Select organization').inputValue(), org.id)
  await heading('Participants & registrations').waitFor()
  await heading('Event tasks').waitFor()
  await heading('No registrations yet').waitFor()
  await heading('A fresh task list').waitFor()
  pass('real login, protected deep link, organization, event details and empty states')

  const participantName = `Participant ${runId}`
  await page.getByRole('link', { name: 'Participants', exact: true }).click()
  await heading('Participants').waitFor()
  await page.getByRole('button', { name: 'Add participant', exact: true }).first().click()
  const participantForm = page.locator('form').filter({ has: page.getByLabel('Full name *', { exact: true }) })
  await participantForm.getByRole('button', { name: 'Add participant', exact: true }).click()
  await participantForm.getByRole('alert').waitFor()
  await page.getByLabel('Full name *', { exact: true }).fill(participantName)
  await participantForm.getByRole('button', { name: 'Add participant', exact: true }).click()
  await page.getByRole('status').filter({ hasText: `${participantName} has been added.` }).waitFor()
  await heading(participantName).waitFor()
  const participants = await request(`/api/v1/participants?organization_id=${org.id}`, { token: owner.token })
  const participant = participants.find(item => item.full_name === participantName)
  assert.ok(participant)
  await page.getByLabel('Search participants by name').fill('no such participant')
  await heading('No matching participants').waitFor()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByRole('link', { name: new RegExp(participantName) }).last().click()
  await heading(participantName).waitFor()
  await page.reload()
  await heading(participantName).waitFor()
  pass('participant validation, creation, search, profile and PostgreSQL persistence on refresh')

  await page.goto(`${base}/events/${event.id}#event-registrations`)
  const registrations = page.locator('#event-registrations')
  await registrations.getByRole('checkbox', { name: participantName, exact: true }).check()
  await registrations.getByRole('button', { name: /^Register Selected/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm registration', exact: true }).click()
  await registrations.getByText('1 participant registered.', { exact: true }).waitFor()
  await registrations.getByRole('link', { name: participantName, exact: true }).waitFor()
  assert.equal(await registrations.getByRole('button', { name: /^Register Selected/ }).count(), 0)
  await page.reload()
  await registrations.getByRole('link', { name: participantName, exact: true }).waitFor()
  const savedRegistrations = await request(`/api/v1/registrations?event_id=${event.id}`, { token: owner.token })
  assert.equal(savedRegistrations.length, 1)
  assert.equal(savedRegistrations[0].participant_id, participant.id)
  pass('real registration, duplicate exclusion and persisted registration after browser refresh')

  const tasks = page.locator('#tasks')
  const taskName = `Prepare venue ${runId}`
  await tasks.getByRole('button', { name: 'Create task', exact: true }).click()
  await tasks.getByLabel('Task name *', { exact: true }).fill(taskName)
  const taskForm = tasks.locator('form').filter({ has: page.getByLabel('Task name *', { exact: true }) })
  await taskForm.getByLabel('Description', { exact: true }).fill('Arrange the test venue.')
  await taskForm.getByLabel('Priority *', { exact: true }).selectOption('high')
  await taskForm.getByLabel('Due at', { exact: true }).fill('2027-02-09T15:30')
  await taskForm.getByRole('button', { name: 'Create task', exact: true }).click()
  await tasks.getByRole('status').filter({ hasText: 'Task created.' }).waitFor()
  await heading(taskName, tasks).waitFor()
  const taskCard = tasks.locator('div.rounded-2xl').filter({ has: heading(taskName) }).last()
  await taskCard.getByLabel('Assign an active member').selectOption(member.id)
  await taskCard.getByRole('button', { name: 'Assign member', exact: true }).click()
  await taskCard.getByRole('status').filter({ hasText: 'Member assigned to task.' }).waitFor()
  await taskCard.getByText(member.name, { exact: true }).waitFor()
  const savedTasks = await request(`/api/v1/tasks?event_id=${event.id}`, { token: owner.token })
  const savedTask = savedTasks.find(item => item.title === taskName)
  assert.ok(savedTask)
  assert.equal(new Date(savedTask.due_at).toISOString(), '2027-02-09T13:30:00.000Z')
  const assignments = await request(`/api/v1/task-assignments?task_id=${savedTask.id}`, { token: owner.token })
  assert.equal(assignments.length, 1)
  assert.equal(assignments[0].user_id, member.id)
  await taskCard.getByRole('button', { name: `Edit ${taskName}`, exact: true }).click()
  await taskCard.getByLabel('Task name *', { exact: true }).fill(`${taskName} updated`)
  await taskCard.getByRole('button', { name: 'Save changes', exact: true }).click()
  await heading(`${taskName} updated`, tasks).waitFor()
  await page.reload()
  await heading(`${taskName} updated`, tasks).waitFor()
  await tasks.locator('div.rounded-2xl').filter({ has: heading(`${taskName} updated`) }).last().getByText(member.name, { exact: true }).waitFor()
  pass('task creation, local-time conversion, assignment, editing and saved state after refresh')

  await page.getByRole('button', { name: 'Start event', exact: true }).click()
  await page.getByRole('button', { name: 'Complete event', exact: true }).waitFor()
  await registrations.getByRole('button', { name: 'Mark attended', exact: true }).click()
  await registrations.getByRole('status').filter({ hasText: 'Attendance has been recorded.' }).waitFor()
  await page.reload()
  await registrations.getByText(/^Attended /).waitFor()
  assert.equal(await registrations.getByRole('button', { name: 'Cancel', exact: true }).count(), 0)
  const attendance = await request(`/api/v1/registrations?event_id=${event.id}`, { token: owner.token })
  assert.ok(attendance[0].attended_at)
  pass('real event activation, attendance and persisted attended state')

  const cancellationParticipant = await request('/api/v1/participants', { token: owner.token, method: 'POST', body: { organization_id: org.id, full_name: `Cancellation participant ${runId}` }, expected: 201 })
  const cancellationRegistration = await request('/api/v1/registrations', { token: owner.token, method: 'POST', body: { event_id: event.id, participant_id: cancellationParticipant.id }, expected: 201 })
  await registrations.getByRole('button', { name: 'Refresh', exact: true }).click()
  const cancellationRow = registrations.locator('li').filter({ has: page.getByRole('link', { name: cancellationParticipant.full_name, exact: true }) })
  page.once('dialog', dialog => dialog.dismiss())
  await cancellationRow.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await request(`/api/v1/registrations?event_id=${event.id}`, { token: owner.token })).find(item => item.id === cancellationRegistration.id).status, 'registered')
  page.once('dialog', dialog => dialog.accept())
  await cancellationRow.getByRole('button', { name: 'Cancel', exact: true }).click()
  await registrations.getByRole('status').filter({ hasText: 'The registration has been cancelled.' }).waitFor()
  await cancellationRow.getByText('Cancelled', { exact: true }).waitFor()
  assert.equal((await request(`/api/v1/registrations?event_id=${event.id}`, { token: owner.token })).find(item => item.id === cancellationRegistration.id).status, 'cancelled')
  assert.equal(await registrations.getByRole('button', { name: /^Register Selected/ }).count(), 0)
  pass('registration cancellation confirms intent and preserves permanent duplicate exclusion')

  await registrations.getByRole('link', { name: participantName, exact: true }).click()
  await heading(participantName).waitFor()
  await page.getByText('Registration status', { exact: true }).waitFor()
  await page.locator(`time[datetime="${attendance[0].attended_at}"]`).waitFor()
  await page.getByLabel('Select organization').selectOption(secondOrg.id)
  await heading('Participants').waitFor()
  await heading('Your participant directory starts here').waitFor()
  await page.goto(`${base}/events/${event.id}`)
  await page.getByRole('alert').filter({ hasText: 'not available in the selected organization' }).waitFor()
  assert.equal(await heading(event.title).count(), 0)
  await page.getByLabel('Select organization').selectOption(org.id)
  await heading('Events').waitFor()
  pass('participant registration lookup, organization switch and cross-scope event protection')

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await heading('Tasks').waitFor()
  await page.getByLabel('Choose an event', { exact: true }).selectOption(event.id)
  await heading(`${taskName} updated`).waitFor()
  await page.getByLabel('Search tasks', { exact: true }).fill('missing task')
  await heading('No matching tasks').waitFor()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await heading(`${taskName} updated`).waitFor()
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Tasks horizontal overflow at ${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Participants', exact: true }).click()
  await heading('Participants').waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  pass('event-scoped Tasks page, filters, responsive widths and mobile navigation')

  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const memberPage = await memberContext.newPage()
  memberPage.on('pageerror', error => runtimeErrors.push(error.message))
  await memberPage.goto(`${base}/events/${event.id}`)
  await heading('Welcome back', memberPage).waitFor()
  await login(memberPage, member)
  await heading(`${taskName} updated`, memberPage).waitFor()
  await memberPage.getByLabel('Update status', { exact: true }).selectOption('in_progress')
  await memberPage.getByRole('status').filter({ hasText: 'Task status updated.' }).waitFor()
  assert.equal(await memberPage.getByRole('button', { name: 'Create task', exact: true }).count(), 0)
  await memberPage.reload()
  assert.equal(await memberPage.getByLabel('Update status', { exact: true }).inputValue(), 'in_progress')
  pass('assigned Member can persist task status and cannot create tasks')

  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const viewerPage = await viewerContext.newPage()
  viewerPage.on('pageerror', error => runtimeErrors.push(error.message))
  await viewerPage.goto(`${base}/events/${event.id}`)
  await heading('Welcome back', viewerPage).waitFor()
  await login(viewerPage, viewer)
  await heading(`${taskName} updated`, viewerPage).waitFor()
  assert.equal(await viewerPage.getByLabel('Update status', { exact: true }).count(), 0)
  assert.equal(await viewerPage.getByRole('button', { name: 'Create task', exact: true }).count(), 0)
  assert.equal(await viewerPage.getByRole('button', { name: /^Register Selected/ }).count(), 0)
  await viewerPage.getByRole('link', { name: 'Participants', exact: true }).click()
  await heading('Participants', viewerPage).waitFor()
  assert.equal(await viewerPage.getByRole('button', { name: 'Add participant', exact: true }).count(), 0)
  await request(`/api/v1/tasks/${savedTask.id}/status`, { token: viewer.token, method: 'PATCH', body: { status: 'done' }, expected: 403 })
  await request(`/api/v1/events/${event.id}`, { token: outsider.token, expected: 404 })
  pass('Viewer read-only UI and real server rejection of unauthorized/cross-tenant requests')

  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`${base}/events/${event.id}#tasks`)
  await heading(`${taskName} updated`).waitFor()
  const currentCard = page.locator('#tasks div.rounded-2xl').filter({ has: heading(`${taskName} updated`) }).last()
  await currentCard.getByRole('button', { name: `Remove ${member.name} from ${taskName} updated`, exact: true }).click()
  await currentCard.getByRole('button', { name: 'Keep assignment', exact: true }).click()
  assert.equal((await request(`/api/v1/task-assignments?task_id=${savedTask.id}`, { token: owner.token })).length, 1)
  await currentCard.getByRole('button', { name: `Remove ${member.name} from ${taskName} updated`, exact: true }).click()
  await currentCard.getByRole('button', { name: 'Remove assignment', exact: true }).click()
  await currentCard.getByRole('status').filter({ hasText: 'Task assignment removed.' }).waitFor()
  assert.equal((await request(`/api/v1/task-assignments?task_id=${savedTask.id}`, { token: owner.token })).length, 0)
  pass('assignment removal requires confirmation and persists the server deletion')

  await page.goto(`${base}/participants`)
  await heading('Participants').waitFor()
  await page.route('**/backend/api/v1/participants?*', route => route.abort())
  await page.reload()
  await page.getByRole('alert').filter({ hasText: 'Unable to reach FieldOps Pro' }).waitFor()
  await page.unroute('**/backend/api/v1/participants?*')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await heading(participantName).waitFor()
  pass('real network interruption shows an error and retries the actual endpoint')

  let saveArrived
  let releaseSave
  let saveFinished
  const arrived = new Promise(done => { saveArrived = done })
  const released = new Promise(done => { releaseSave = done })
  const finished = new Promise(done => { saveFinished = done })
  await page.route('**/backend/api/v1/participants', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    saveArrived()
    await released
    await route.fulfill({ response })
    saveFinished()
  })
  const delayedName = `Saved while switching ${runId}`
  await page.getByRole('button', { name: 'Add participant', exact: true }).first().click()
  await page.getByLabel('Full name *', { exact: true }).fill(delayedName)
  await page.locator('form').filter({ has: page.getByLabel('Full name *', { exact: true }) }).getByRole('button', { name: 'Add participant', exact: true }).click()
  await arrived
  await page.getByLabel('Select organization').selectOption(secondOrg.id)
  await heading('Your participant directory starts here').waitFor()
  releaseSave()
  await finished
  await page.unroute('**/backend/api/v1/participants')
  assert.equal(await page.getByText(delayedName, { exact: false }).count(), 0)
  assert.deepEqual(await request(`/api/v1/participants?organization_id=${secondOrg.id}`, { token: owner.token }), [])
  await page.getByLabel('Select organization').selectOption(org.id)
  await heading(delayedName).waitFor()
  pass('late real save cannot leak feedback/data across organizations and refreshes its original workspace')

  const longTitle = 'X'.repeat(150)
  await request(`/api/v1/events/${event.id}`, { token: owner.token, method: 'PATCH', body: { title: longTitle } })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(`${base}/events/${event.id}`)
  await heading(longTitle).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Maximum-length unbroken event title must fit a mobile viewport')
  await request(`/api/v1/events/${event.id}`, { token: owner.token, method: 'PATCH', body: { title: event.title } })
  pass('maximum-length real event titles wrap without mobile overflow')

  // CSV preview reports invalid rows without writing; only explicitly reviewed
  // valid rows are committed, together with optional event registrations.
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`${base}/participants?import=1`)
  await heading('Import participants').waitFor()
  const csvNames = Array.from({ length: 3 }, (_, index) => `CSV new ${runId} ${index}`)
  const csv = `full_name\n${csvNames.join('\n')}\n${csvNames[0]}\n${participantName}\n\n${'X'.repeat(151)}\n`
  const countBeforePreview = (await request(`/api/v1/participants?organization_id=${org.id}`, { token: owner.token })).length
  await page.getByLabel('CSV or XLSX file').setInputFiles({ name: 'review.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('button', { name: 'Preview import', exact: true }).click()
  await heading('Server preview').waitFor()
  const previewRows = page.getByRole('region', { name: 'Import preview rows' })
  assert.equal(await previewRows.getByRole('checkbox', { checked: true }).count(), 3)
  assert.equal(await previewRows.getByRole('checkbox', { disabled: true }).count(), 4)
  assert.equal((await request(`/api/v1/participants?organization_id=${org.id}`, { token: owner.token })).length, countBeforePreview)
  await page.getByRole('checkbox', { name: /Skip the 4 invalid or duplicate rows/ }).check()
  await page.getByRole('checkbox', { name: /Also register the imported participants/ }).check()
  await page.getByLabel('Import registration event', { exact: true }).selectOption(event.id)
  await page.getByRole('button', { name: 'Review and import', exact: true }).click()
  await page.getByRole('dialog', { name: 'Confirm participant import' }).getByRole('button', { name: 'Import selected participants', exact: true }).click()
  await heading('Import complete').waitFor()
  const csvSaved = (await request(`/api/v1/participants?organization_id=${org.id}`, { token: owner.token })).filter(item => csvNames.includes(item.full_name))
  assert.equal(csvSaved.length, 3)
  const csvRegistrations = await request(`/api/v1/registrations?event_id=${event.id}`, { token: owner.token })
  assert.ok(csvSaved.every(item => csvRegistrations.some(row => row.participant_id === item.id)))
  await page.reload()
  await heading(csvNames[0]).waitFor()
  pass('CSV preview identifies row errors/duplicates, writes nothing, and confirms valid-row import plus event registration')

  // Real server commits, then the browser deliberately loses the response.
  // Retry must return the durable receipt instead of creating new participants.
  const workbook = spawnSync(python, ['-B', '-c', `from openpyxl import Workbook; import io,sys; w=Workbook(); s=w.active; s.append(['full_name']); s.append(['XLSX ${runId} one']); s.append(['XLSX ${runId} two']); s.append(['=1+1']); b=io.BytesIO(); w.save(b); sys.stdout.buffer.write(b.getvalue())`], { windowsHide: true })
  assert.equal(workbook.status, 0, 'Generate XLSX fixture with installed parser')
  await page.getByLabel('CSV or XLSX file').setInputFiles({ name: 'safe.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook.stdout })
  await page.getByRole('button', { name: 'Preview import', exact: true }).click()
  await heading('Server preview').waitFor()
  await page.getByText(/Formula cells are not accepted/).waitFor()
  await page.getByRole('checkbox', { name: /Skip the 1 invalid or duplicate row/ }).check()
  let importLost = false
  const importAttempts = []
  await page.route('**/backend/api/v1/participants/import', async route => {
    importAttempts.push(route.request().postDataJSON())
    if (!importLost) { importLost = true; await route.fetch(); return route.abort() }
    return route.continue()
  })
  await page.getByRole('button', { name: 'Review and import', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Import selected participants', exact: true }).click()
  await page.getByRole('button', { name: 'Retry unchanged import', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Retry unchanged import', exact: true }).click()
  await heading('Import confirmed').waitFor()
  assert.equal(importAttempts.length, 2)
  assert.deepEqual(importAttempts[0], importAttempts[1])
  await page.unroute('**/backend/api/v1/participants/import')
  assert.equal((await request(`/api/v1/participants?organization_id=${org.id}`, { token: owner.token })).filter(item => item.full_name.startsWith(`XLSX ${runId}`)).length, 2)
  pass('real XLSX preview rejects formulas and a lost-response import safely replays the same receipt')

  await page.getByRole('button', { name: 'Import another file', exact: true }).click()
  const hundredNames = Array.from({ length: 100 }, (_, index) => `Bulk ${runId} ${String(index).padStart(3, '0')}`)
  await page.getByLabel('CSV or XLSX file').setInputFiles({ name: 'hundred.csv', mimeType: 'text/csv', buffer: Buffer.from(`full_name\n${hundredNames.join('\n')}\n`) })
  await page.getByRole('button', { name: 'Preview import', exact: true }).click()
  await heading('Server preview').waitFor()
  assert.equal(await page.getByRole('region', { name: 'Import preview rows' }).getByRole('checkbox', { checked: true }).count(), 100)
  await page.getByRole('button', { name: 'Review and import', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Import selected participants', exact: true }).click()
  await heading('Import complete').waitFor()
  const allPeople = await request(`/api/v1/participants?organization_id=${org.id}`, { token: owner.token })
  const hundred = allPeople.filter(item => hundredNames.includes(item.full_name))
  assert.equal(hundred.length, 100)
  const bulkEvent = await request('/api/v1/events', { token: owner.token, method: 'POST', body: { organization_id: org.id, title: `Hundred-person event ${runId}`, start_at: '2027-03-01T09:00:00Z', end_at: '2027-03-01T17:00:00Z', capacity: 150 }, expected: 201 })
  const earlier = allPeople.filter(item => !hundredNames.includes(item.full_name))
  await request('/api/v1/registrations/bulk', { token: owner.token, method: 'POST', body: { event_id: bulkEvent.id, participant_ids: earlier.map(item => item.id), idempotency_key: randomUUID() } })
  await page.goto(`${base}/events/${bulkEvent.id}#event-registrations`)
  const bulkSection = page.locator('#event-registrations')
  await bulkSection.getByRole('button', { name: 'Select All Eligible', exact: true }).waitFor()
  assert.equal(await bulkSection.getByRole('checkbox', { name: participantName, exact: true }).count(), 0)
  await bulkSection.getByLabel('Search eligible participants').fill(hundredNames[0])
  await bulkSection.getByRole('button', { name: 'Select All Eligible', exact: true }).click()
  await bulkSection.getByRole('button', { name: 'Register Selected (100)', exact: true }).waitFor()
  await bulkSection.getByRole('button', { name: 'Deselect All', exact: true }).click()
  await bulkSection.getByRole('button', { name: 'Select All Eligible', exact: true }).click()
  let bulkLost = false
  const bulkAttempts = []
  await page.route('**/backend/api/v1/registrations/bulk', async route => {
    bulkAttempts.push(route.request().postDataJSON())
    if (!bulkLost) { bulkLost = true; await route.fetch(); return route.abort() }
    return route.continue()
  })
  await bulkSection.getByRole('button', { name: 'Register Selected (100)', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm registration', exact: true }).click()
  await bulkSection.getByRole('button', { name: 'Retry same batch', exact: true }).waitFor()
  await bulkSection.getByRole('button', { name: 'Refresh registrations', exact: true }).click()
  await bulkSection.getByRole('button', { name: 'Retry same batch', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm same batch', exact: true }).click()
  await bulkSection.getByText('100 participants registered.', { exact: true }).waitFor()
  assert.equal(bulkAttempts.length, 2)
  assert.deepEqual(bulkAttempts[0], bulkAttempts[1])
  await page.unroute('**/backend/api/v1/registrations/bulk')
  assert.equal((await request(`/api/v1/registrations?event_id=${bulkEvent.id}`, { token: owner.token })).length, allPeople.length)
  await page.reload()
  await bulkSection.getByText(/Every participant already has a registration/).waitFor()
  assert.equal(await bulkSection.getByRole('button', { name: /^Register Selected/ }).count(), 0)
  pass('100-person CSV import, searchable Select All/Deselect All, atomic bulk registration, lost-response replay and refresh')

  assert.deepEqual(runtimeErrors, [])
  pass('no browser runtime errors')
  if (process.env.FIELDOPS_TEST_SCREENSHOT_DIR) {
    await page.goto(`${base}/events/${event.id}`)
    await heading(`${taskName} updated`).waitFor()
    await page.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'day9-event.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'day9-mobile.png'), fullPage: true })
  }
  console.log(`REAL POSTGRESQL BROWSER RESULT: ${passes.length} scenarios passed; all data confined to ${health.test_database}`)
} catch (error) {
  if (process.env.FIELDOPS_TEST_SCREENSHOT_DIR && failureScreenshotPage) await failureScreenshotPage.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'day9-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  if (browser) await browser.close()
  if (frontend) await new Promise(done => frontend.httpServer.close(done))
  server.kill()
  await new Promise(done => { if (server.exitCode !== null) return done(); server.once('exit', done); setTimeout(done, 2000) })
}
