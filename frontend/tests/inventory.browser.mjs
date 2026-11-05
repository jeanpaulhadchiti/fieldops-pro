/** Day 11 browser -> Vite -> FastAPI -> explicitly disposable local PostgreSQL. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const apiPort = Number(process.env.FIELDOPS_TEST_API_PORT || 8027)
const apiBase = `http://127.0.0.1:${apiPort}`
const server = spawn(python, ['-B', '-m', 'uvicorn', 'day9_server:create_app', '--factory', '--app-dir', 'tests', '--host', '127.0.0.1', '--port', String(apiPort), '--log-level', 'warning'], {
  cwd: backendDir, env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', () => {})
const runId = randomUUID().slice(0, 8)
const screenshotDir = process.env.FIELDOPS_TEST_SCREENSHOT_DIR || resolve(tmpdir(), `fieldops-day11-${runId}`)
mkdirSync(screenshotDir, { recursive: true })
const passes = []
const pass = label => { passes.push(label); console.log(`PASS ${label}`) }
const runtimeErrors = []
let frontend, browser, page

async function request(path, { actor, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  })
  assert.equal(response.status, expected, `${method} ${path} HTTP status`)
  return response.status === 204 ? null : response.json()
}
async function account(label) {
  const values = { name: `Inventory ${label} ${runId}`, email: `inventory-browser-${label}-${runId}@example.com`, password: `A!${randomUUID()}${randomUUID()}` }
  const profile = await request('/auth/register', { method: 'POST', body: values, expected: 201 })
  const login = await request('/auth/login', { method: 'POST', body: { email: values.email, password: values.password } })
  return { ...values, id: profile.id, token: login.access_token }
}
const base = 'http://127.0.0.1:5197'
const heading = (name, target = page) => target.getByRole('heading', { name, exact: true })
async function signIn(target, actor) {
  await target.goto(`${base}/inventory`)
  await target.getByLabel('Email address', { exact: true }).fill(actor.email)
  await target.getByLabel('Password', { exact: true }).fill(actor.password)
  await target.getByRole('button', { name: 'Sign in', exact: true }).click()
  await heading('Inventory', target).waitFor()
}
const formByField = label => page.locator('form').filter({ has: page.getByLabel(label, { exact: true }) })

try {
  let health
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { health = await request('/health'); break } catch { await new Promise(done => setTimeout(done, 200)) }
    if (server.exitCode !== null) throw new Error('Isolated inventory test API exited before startup')
  }
  assert.equal(health?.test_database, databaseUrl.pathname.slice(1), 'Verify exact disposable database before any writes')
  assert.equal(health?.database_type, 'postgresql')
  const owner = await account('Owner')
  const admin = await account('Admin')
  const member = await account('Member')
  const viewer = await account('Viewer')
  const outsider = await account('Outsider')
  const org = await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: { name: `${runId} Inventory team`, organization_type: 'NGO', country: 'LB', city: 'Beirut', allow_possible_duplicate: true } })
  const other = await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: { name: `${runId} Other inventory`, organization_type: 'NGO', country: 'LB', city: 'Byblos', allow_possible_duplicate: true } })
  for (const [actor, role] of [[admin, 'Admin'], [member, 'Member'], [viewer, 'Viewer']]) {
    await request(`/organizations/${org.id}/members`, { actor: owner, method: 'POST', expected: 201, body: { email: actor.email, role } })
  }
  frontend = await preview({ root: frontendDir, preview: { host: '127.0.0.1', port: 5197, strictPort: true, proxy: { '/backend': { target: apiBase, changeOrigin: true, rewrite: path => path.replace(/^\/backend/, '') } } } })
  browser = await chromium.launch({ channel: process.env.FIELDOPS_BROWSER_CHANNEL || 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Beirut' })
  page = await context.newPage()
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await signIn(page, owner)
  await page.getByLabel('Select organization', { exact: true }).selectOption(org.id)
  await heading('Inventory').waitFor()
  pass('real Owner login, protected Inventory route and organization selection')

  // Taxonomy names/labels are shared with the actual forms, without test-only hooks.
  const categoryName = `Camping ${runId}`
  const locationName = `Main store ${runId}`
  const categoryForm = formByField('Category Name *')
  await categoryForm.getByLabel('Category Name *', { exact: true }).fill('   ')
  await categoryForm.getByRole('button', { name: 'Create Category', exact: true }).click()
  await categoryForm.getByRole('alert').waitFor()
  await categoryForm.getByLabel('Category Name *', { exact: true }).fill(`  ${categoryName}  `)
  await categoryForm.getByLabel('Description', { exact: true }).fill('  Outdoor equipment  ')
  await categoryForm.getByRole('button', { name: 'Create Category', exact: true }).click()
  await heading(categoryName).waitFor()
  const locationForm = formByField('Storage Location Name *')
  await locationForm.getByLabel('Storage Location Name *', { exact: true }).fill('   ')
  await locationForm.getByRole('button', { name: 'Create Storage Location', exact: true }).click()
  await locationForm.getByRole('alert').waitFor()
  await locationForm.getByLabel('Storage Location Name *', { exact: true }).fill(`  ${locationName}  `)
  await locationForm.getByLabel('Description', { exact: true }).fill('  Ground floor  ')
  await locationForm.getByRole('button', { name: 'Create Storage Location', exact: true }).click()
  await heading(locationName).waitFor()
  const categories = await request(`/api/v1/inventory/categories?organization_id=${org.id}`, { actor: owner })
  const locations = await request(`/api/v1/inventory/locations?organization_id=${org.id}`, { actor: owner })
  const category = categories.find(item => item.name === categoryName)
  const location = locations.find(item => item.name === locationName)
  assert.equal(category.description, 'Outdoor equipment')
  assert.equal(location.description, 'Ground floor')
  pass('category and location required-name validation, creation, trimming and persisted descriptions')

  for (const [kind, label, name, id, prefix] of [['categories', 'category', categoryName, category.id, 'category'], ['locations', 'storage location', locationName, location.id, 'location']]) {
    await page.getByRole('button', { name: `Edit ${label} ${name}`, exact: true }).click()
    const edit = page.locator('form').filter({ has: page.locator(`#${prefix}-edit-name`) })
    await edit.getByLabel('Description', { exact: true }).fill(`Updated ${label}`)
    await edit.getByRole('button', { name: kind === 'categories' ? 'Save Category' : 'Save Storage Location', exact: true }).click()
    await heading(kind === 'categories' ? 'Create Category' : 'Create Storage Location').waitFor()
    const stored = await request(`/api/v1/inventory/${kind}/${id}?organization_id=${org.id}`, { actor: owner })
    assert.equal(stored.description, `Updated ${label}`)
    const unused = await request(`/api/v1/inventory/${kind}`, { actor: owner, method: 'POST', expected: 201, body: { organization_id: org.id, name: `Unused ${label} ${runId}` } })
    await page.reload()
    await page.getByRole('button', { name: `Delete ${label} ${unused.name}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: `Delete ${label}`, exact: true }).click()
    await heading(unused.name).waitFor({ state: 'hidden' })
    await request(`/api/v1/inventory/${kind}/${unused.id}?organization_id=${org.id}`, { actor: owner, expected: 404 })
  }
  pass('category and location editing persists; confirmed deletion removes only unused records')

  const itemName = `Tent ${runId}`
  const itemForm = formByField('Equipment Name *')
  await itemForm.getByLabel('Equipment Name *', { exact: true }).fill(itemName)
  await itemForm.getByLabel('SKU', { exact: true }).fill(`TENT-${runId}`)
  await itemForm.getByLabel('Minimum Stock *', { exact: true }).fill('2.001')
  await itemForm.getByRole('button', { name: 'Create Equipment', exact: true }).click()
  await itemForm.getByRole('alert').waitFor()
  await itemForm.getByLabel('Minimum Stock *', { exact: true }).fill('2.50')
  await itemForm.getByLabel('Category', { exact: true }).selectOption(category.id)
  await itemForm.getByLabel('Storage Location', { exact: true }).selectOption(location.id)
  await itemForm.getByRole('button', { name: 'Create Equipment', exact: true }).click()
  await heading(itemName).waitFor()
  const itemsPath = `/api/v1/inventory/items?organization_id=${org.id}`
  const item = (await request(itemsPath, { actor: owner })).find(value => value.name === itemName)
  assert.ok(item)
  assert.equal(item.category_id, category.id)
  assert.equal(item.location_id, location.id)
  assert.equal(Number(item.current_quantity), 0)
  assert.equal(Number(item.minimum_quantity), 2.5)
  pass('equipment precision validation, category/location assignment and stock-zero creation')

  for (const [label, name] of [['category', categoryName], ['storage location', locationName]]) {
    await page.getByRole('button', { name: `Delete ${label} ${name}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: `Delete ${label}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: /cannot delete|referenced/i }).waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Go back', exact: true }).click()
    await heading(name).waitFor()
  }
  pass('used category/location deletion returns visible server conflicts and preserves both records')

  await page.getByRole('button', { name: `Edit ${itemName}`, exact: true }).click()
  const editForm = page.locator('form').filter({ has: page.locator('#edit-name') })
  await editForm.getByLabel('Equipment Name *', { exact: true }).fill(`${itemName} updated`)
  await editForm.getByLabel('Category', { exact: true }).selectOption('')
  await editForm.getByLabel('Storage Location', { exact: true }).selectOption('')
  await editForm.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const updatedName = `${itemName} updated`
  await heading(updatedName).waitFor()
  let saved = await request(`/api/v1/inventory/items/${item.id}?organization_id=${org.id}`, { actor: owner })
  assert.equal(saved.category_id, null)
  assert.equal(saved.location_id, null)
  await page.getByRole('button', { name: `Edit ${updatedName}`, exact: true }).click()
  await editForm.getByLabel('Category', { exact: true }).selectOption(category.id)
  await editForm.getByLabel('Storage Location', { exact: true }).selectOption(location.id)
  await editForm.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await page.reload()
  await heading(updatedName).waitFor()
  saved = await request(`/api/v1/inventory/items/${item.id}?organization_id=${org.id}`, { actor: owner })
  assert.equal(saved.category_id, category.id)
  assert.equal(saved.location_id, location.id)
  pass('equipment editing clears nullable assignments, restores them and persists after refresh')

  await page.getByRole('button', { name: `Stock & history ${updatedName}`, exact: true }).click()
  await heading(`Stock & history: ${updatedName}`).waitFor()
  const movementForm = formByField('Movement type')
  async function move(type, quantity, notes = '') {
    await movementForm.getByLabel('Movement type', { exact: true }).selectOption(type)
    await movementForm.getByLabel('Quantity', { exact: true }).fill(quantity)
    await movementForm.getByLabel('Notes / adjustment reason', { exact: true }).fill(notes)
    const response = page.waitForResponse(response => response.url().includes('/inventory/movements') && response.request().method() === 'POST')
    await movementForm.getByRole('button', { name: 'Record movement', exact: true }).click()
    assert.equal((await response).status(), 201)
    await movementForm.getByRole('button', { name: 'Record movement', exact: true }).waitFor({ state: 'visible' })
    await page.waitForLoadState('networkidle')
  }
  await move('opening', '1.10', 'Initial count')
  assert.equal(await movementForm.getByLabel('Movement type', { exact: true }).locator('option[value="opening"]').isEnabled(), false)
  await move('receive', '2.20', 'Delivery')
  await move('issue', '0.30', 'Event issue')
  await move('return', '0.10', 'Unused return')
  await move('adjustment', '-0.10', 'Recount')
  const historyPath = `/api/v1/inventory/movements?organization_id=${org.id}&item_id=${item.id}`
  let history = await request(historyPath, { actor: owner })
  assert.deepEqual(history.map(entry => entry.sequence_number), [5, 4, 3, 2, 1])
  assert.deepEqual(history.map(entry => Number(entry.quantity_delta)), [-0.1, 0.1, -0.3, 2.2, 1.1])
  assert.equal(Number(history[0].quantity_after), 3)
  assert.ok(history.every(entry => entry.actor_id === owner.id))
  const historyTable = page.getByRole('table', { name: `Movement history for ${updatedName}`, exact: true })
  await historyTable.getByText(owner.id, { exact: true }).first().waitFor()
  await historyTable.getByText('Recount', { exact: true }).waitFor()
  pass('all five movement types preserve exact signed quantities, audit sequence, actor and history')

  for (const [type, quantity, notes] of [['receive', 'NaN', ''], ['receive', '0', ''], ['receive', '0.001', ''], ['issue', '3.01', ''], ['adjustment', '-3.01', 'Recount'], ['adjustment', '-1', '  ']]) {
    await movementForm.getByLabel('Movement type', { exact: true }).selectOption(type)
    await movementForm.getByLabel('Quantity', { exact: true }).fill(quantity)
    await movementForm.getByLabel('Notes / adjustment reason', { exact: true }).fill(notes)
    await movementForm.getByRole('button', { name: 'Record movement', exact: true }).click()
    await movementForm.getByRole('alert').first().waitFor()
  }
  assert.equal((await request(historyPath, { actor: owner })).length, 5)
  await request(`/api/v1/inventory/items/${item.id}?organization_id=${org.id}`, { actor: owner, method: 'DELETE', expected: 409 })
  pass('client rejects non-finite/zero/overprecision/overdraw/reasonless movements; server blocks nonzero archive')

  await move('adjustment', '-3', 'Empty stock for archive')
  await page.getByRole('button', { name: `Archive ${updatedName}`, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Archive equipment', exact: true }).click()
  await heading(updatedName).waitFor({ state: 'hidden' })
  await page.getByLabel('Equipment view', { exact: true }).selectOption('archived')
  await heading(updatedName).waitFor()
  await page.getByRole('button', { name: `Restore ${updatedName}`, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Restore equipment', exact: true }).click()
  await heading(updatedName).waitFor({ state: 'hidden' })
  await page.getByLabel('Equipment view', { exact: true }).selectOption('active')
  await heading(updatedName).waitFor()
  saved = await request(`/api/v1/inventory/items/${item.id}?organization_id=${org.id}`, { actor: owner })
  assert.equal(saved.archived, false)
  assert.equal((await request(historyPath, { actor: owner })).length, 6)
  pass('zero-stock archive and archived-view restore require confirmation and preserve audit history')

  await page.getByRole('button', { name: `Stock & history ${updatedName}`, exact: true }).click()
  let releaseMovement, markSaved, markMovementFinished
  const movementReleased = new Promise(done => { releaseMovement = done })
  const movementSaved = new Promise(done => { markSaved = done })
  const movementFinished = new Promise(done => { markMovementFinished = done })
  await page.route('**/backend/api/v1/inventory/movements', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    assert.equal(response.status(), 201)
    markSaved()
    await movementReleased
    await route.fulfill({ response }).catch(() => {})
    markMovementFinished()
  })
  await movementForm.getByLabel('Movement type', { exact: true }).selectOption('receive')
  await movementForm.getByLabel('Quantity', { exact: true }).fill('1')
  await movementForm.getByRole('button', { name: 'Record movement', exact: true }).click()
  await movementSaved
  await page.getByLabel('Select organization', { exact: true }).selectOption(other.id)
  await heading('No inventory items yet').waitFor()
  releaseMovement()
  await movementFinished
  await page.unroute('**/backend/api/v1/inventory/movements')
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByLabel('Select organization', { exact: true }).inputValue(), other.id)
  assert.equal(await page.getByText('Stock movement recorded.', { exact: true }).count(), 0)
  assert.equal(await heading(updatedName).count(), 0)
  await page.getByLabel('Select organization', { exact: true }).selectOption(org.id)
  await heading(updatedName).waitFor()
  saved = await request(`/api/v1/inventory/items/${item.id}?organization_id=${org.id}`, { actor: owner })
  assert.equal(Number(saved.current_quantity), 1)
  pass('a delayed real movement save refreshes its original organization without leaking feedback into the new workspace')

  await page.route('**/backend/api/v1/inventory/items?*', route => route.abort('failed'))
  await page.reload()
  await page.getByRole('alert').filter({ hasText: /unable to reach/i }).waitFor()
  await page.unroute('**/backend/api/v1/inventory/items?*')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await heading(updatedName).waitFor()
  pass('real inventory network failure displays a visible error and retry reloads the actual endpoint')

  const raceItem = await request('/api/v1/inventory/items', { actor: owner, method: 'POST', expected: 201, body: { organization_id: org.id, name: `Archive race ${runId}` } })
  await page.reload()
  await page.getByRole('button', { name: `Archive ${raceItem.name}`, exact: true }).click()
  await request('/api/v1/inventory/movements', { actor: admin, method: 'POST', expected: 201, body: { organization_id: org.id, item_id: raceItem.id, movement_type: 'receive', quantity_delta: '1' } })
  await page.getByRole('dialog').getByRole('button', { name: 'Archive equipment', exact: true }).click()
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: /zero|stock/i }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Go back', exact: true }).click()
  await request('/api/v1/inventory/movements', { actor: admin, method: 'POST', expected: 201, body: { organization_id: org.id, item_id: raceItem.id, movement_type: 'issue', quantity_delta: '-1' } })
  await request(`/api/v1/inventory/items/${raceItem.id}?organization_id=${org.id}`, { actor: owner, method: 'DELETE', expected: 204 })
  pass('a concurrent stock receipt blocks archive and exposes the 409 conflict inside the confirmation dialog')

  // At least two API pages: totals/search must include record 501, not merely the first 100 or 500.
  const fixtureNames = Array.from({ length: 505 }, (_, index) => `Fixture ${runId} ${String(index).padStart(4, '0')}`)
  const fixtures = []
  for (let offset = 0; offset < fixtureNames.length; offset += 10) {
    fixtures.push(...await Promise.all(fixtureNames.slice(offset, offset + 10).map(name => request('/api/v1/inventory/items', {
      actor: owner, method: 'POST', expected: 201, body: { organization_id: org.id, name, category_id: category.id, location_id: location.id, minimum_quantity: '1' },
    }))))
  }
  await request('/api/v1/inventory/movements', { actor: owner, method: 'POST', expected: 201, body: { organization_id: org.id, item_id: fixtures[0].id, movement_type: 'opening', quantity_delta: '1' } })
  await page.reload()
  await page.getByRole('status').filter({ hasText: '506 matching of 506 active equipment' }).waitFor()
  const stats = page.getByRole('region', { name: 'Inventory statistics', exact: true })
  await stats.getByText('506', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Page 2 of 11' }).waitFor()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByLabel('Search equipment', { exact: true }).fill(fixtureNames[504])
  await heading(fixtureNames[504]).waitFor()
  await page.getByLabel('Category filter', { exact: true }).selectOption(category.id)
  await page.getByLabel('Location filter', { exact: true }).selectOption(location.id)
  await page.getByLabel('Low stock only', { exact: true }).check()
  await heading(fixtureNames[504]).waitFor()
  await page.getByLabel('Search equipment', { exact: true }).fill(fixtureNames[0])
  await heading('No matching equipment').waitFor()
  await page.getByLabel('Low stock only', { exact: true }).uncheck()
  await heading(fixtureNames[0]).waitFor()
  await page.getByLabel('Low stock only', { exact: true }).check()
  await page.getByLabel('Search equipment', { exact: true }).fill('no matching equipment')
  assert.equal(await heading(fixtureNames[504]).count(), 0)
  await page.getByLabel('Search equipment', { exact: true }).fill('')
  await page.getByLabel('Low stock only', { exact: true }).uncheck()
  await page.getByLabel('Category filter', { exact: true }).selectOption('')
  await page.getByLabel('Location filter', { exact: true }).selectOption('')
  pass('search and combined category/location/low-stock filters include equipment beyond the first 500 records')

  await page.getByLabel('Select organization', { exact: true }).selectOption(other.id)
  await heading('Inventory').waitFor()
  assert.equal(await heading(updatedName).count(), 0)
  assert.equal(await heading(categoryName).count(), 0)
  assert.equal(await heading(locationName).count(), 0)
  assert.equal(await page.getByLabel('Category', { exact: true }).locator(`option[value="${category.id}"]`).count(), 0)
  await request(`/api/v1/inventory/items/${item.id}?organization_id=${other.id}`, { actor: owner, expected: 404 })
  await request(`/api/v1/inventory/movements/${history[0].id}?organization_id=${other.id}`, { actor: owner, expected: 404 })
  await request(`/api/v1/inventory/items?organization_id=${org.id}`, { actor: outsider, expected: 404 })
  await page.getByLabel('Select organization', { exact: true }).selectOption(org.id)
  await page.getByLabel('Search equipment', { exact: true }).fill(updatedName)
  await heading(updatedName).waitFor()
  pass('organization switching clears item/taxonomy/form data and real cross-organization access returns 404')

  for (const actor of [member, viewer]) {
    const readContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const readPage = await readContext.newPage()
    readPage.on('pageerror', error => runtimeErrors.push(error.message))
    await signIn(readPage, actor)
    await readPage.getByLabel('Search equipment', { exact: true }).fill(updatedName)
    await heading(updatedName, readPage).waitFor()
    assert.equal(await readPage.getByRole('button', { name: 'Create Equipment', exact: true }).count(), 0)
    assert.equal(await readPage.getByRole('button', { name: `Edit ${updatedName}`, exact: true }).count(), 0)
    assert.equal(await readPage.getByRole('button', { name: `Archive ${updatedName}`, exact: true }).count(), 0)
    await readPage.getByRole('button', { name: `Stock & history ${updatedName}`, exact: true }).click()
    await readPage.getByRole('table', { name: `Movement history for ${updatedName}`, exact: true }).waitFor()
    assert.equal(await readPage.getByRole('button', { name: 'Record movement', exact: true }).count(), 0)
    await request('/api/v1/inventory/items', { actor, method: 'POST', expected: 403, body: { organization_id: org.id, name: 'Forbidden' } })
    await request('/api/v1/inventory/movements', { actor, method: 'POST', expected: 403, body: { organization_id: org.id, item_id: item.id, movement_type: 'receive', quantity_delta: '1' } })
    await readContext.close()
  }
  pass('Member and Viewer see history without write controls; real item/movement writes return 403')

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const adminPage = await adminContext.newPage()
  await signIn(adminPage, admin)
  await adminPage.getByRole('button', { name: 'Create Equipment', exact: true }).waitFor()
  await request('/api/v1/inventory/categories', { actor: admin, method: 'POST', expected: 201, body: { organization_id: org.id, name: `Admin category ${runId}` } })
  await adminContext.close()
  pass('active Admin has equipment write UI and successful server-authorized taxonomy writes')

  await request(`/organizations/${org.id}/archive`, { actor: owner, method: 'POST', body: { confirmation_name: org.name } })
  await page.reload()
  await heading(org.name).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Create Equipment', exact: true }).count(), 0)
  await request('/api/v1/inventory/categories', { actor: owner, method: 'POST', expected: 409, body: { organization_id: org.id, name: 'Archived write' } })
  await request('/api/v1/inventory/locations', { actor: owner, method: 'POST', expected: 409, body: { organization_id: org.id, name: 'Archived write' } })
  await request('/api/v1/inventory/items', { actor: owner, method: 'POST', expected: 409, body: { organization_id: org.id, name: 'Archived write' } })
  await request('/api/v1/inventory/movements', { actor: owner, method: 'POST', expected: 409, body: { organization_id: org.id, item_id: item.id, movement_type: 'receive', quantity_delta: '1' } })
  await request(`/organizations/${org.id}/restore`, { actor: owner, method: 'POST', body: { confirmation_name: org.name } })
  await page.reload()
  await heading('Inventory').waitFor()
  await page.getByLabel('Search equipment', { exact: true }).fill(updatedName)
  await heading(updatedName).waitFor()
  pass('archived organization hides workspace writes and all inventory POST families return 409 until restored')

  await page.setViewportSize({ width: 1280, height: 1050 })
  await page.getByRole('button', { name: `Stock & history ${updatedName}`, exact: true }).click()
  await page.getByRole('table', { name: `Movement history for ${updatedName}`, exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: resolve(screenshotDir, 'day11-inventory-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Search equipment', { exact: true }).fill(updatedName)
  await page.getByRole('button', { name: `Stock & history ${updatedName}`, exact: true }).click()
  await page.getByRole('table', { name: `Movement history for ${updatedName}`, exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: resolve(screenshotDir, 'day11-inventory-mobile.png'), fullPage: true })
  pass('mobile inventory, filters and audit table contain overflow within their own scroll region')

  const lateContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const latePage = await lateContext.newPage()
  latePage.on('pageerror', error => runtimeErrors.push(error.message))
  await signIn(latePage, owner)
  await latePage.getByLabel('Select organization', { exact: true }).selectOption(other.id)
  let releaseCategory, markCategorySaved, markCategoryFinished
  const categoryReleased = new Promise(done => { releaseCategory = done })
  const categorySaved = new Promise(done => { markCategorySaved = done })
  const categoryFinished = new Promise(done => { markCategoryFinished = done })
  const lateName = `Old account category ${runId}`
  await latePage.route('**/backend/api/v1/inventory/categories', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    assert.equal(response.status(), 201)
    markCategorySaved()
    await categoryReleased
    await route.fulfill({ response }).catch(() => {})
    markCategoryFinished()
  })
  await latePage.getByLabel('Category Name *', { exact: true }).fill(lateName)
  await latePage.getByRole('button', { name: 'Create Category', exact: true }).click()
  await categorySaved
  await latePage.getByRole('button', { name: 'Sign out', exact: true }).click()
  await latePage.getByLabel('Email address', { exact: true }).fill(member.email)
  await latePage.getByLabel('Password', { exact: true }).fill(member.password)
  await latePage.getByRole('button', { name: 'Sign in', exact: true }).click()
  await heading('Inventory', latePage).waitFor()
  releaseCategory()
  await categoryFinished
  await latePage.unroute('**/backend/api/v1/inventory/categories')
  await latePage.waitForLoadState('networkidle')
  assert.equal(await latePage.getByLabel('Select organization', { exact: true }).inputValue(), org.id)
  assert.equal(await heading(lateName, latePage).count(), 0)
  assert.equal(await latePage.getByText('Category created successfully!', { exact: true }).count(), 0)
  assert.equal(await latePage.getByRole('button', { name: 'Create Equipment', exact: true }).count(), 0)
  await latePage.getByLabel('Search equipment', { exact: true }).fill(updatedName)
  await heading(updatedName, latePage).waitFor()
  await lateContext.close()
  pass('late mutation from an older Owner session cannot expose its organization or success state after Member login')
  assert.deepEqual(runtimeErrors, [])
  pass('no browser runtime errors')
  console.log(`DAY 11 INVENTORY BROWSER RESULT: ${passes.length} scenarios passed; all data confined to ${health.test_database}`)
  console.log(`Inventory screenshots: ${screenshotDir}`)
} catch (error) {
  if (page) await page.screenshot({ path: resolve(screenshotDir, 'day11-inventory-failure.png'), fullPage: true }).catch(() => {})
  console.log(`Inventory failure screenshot: ${resolve(screenshotDir, 'day11-inventory-failure.png')}`)
  throw error
} finally {
  if (browser) await browser.close()
  if (frontend) await new Promise(done => frontend.httpServer.close(done))
  server.kill()
  await new Promise(done => { if (server.exitCode !== null) return done(); server.once('exit', done); setTimeout(done, 2000) })
}
