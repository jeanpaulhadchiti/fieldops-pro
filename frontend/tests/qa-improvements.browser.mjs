/** Real QA01–QA06 browser acceptance, confined to disposable PostgreSQL. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
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
const port = Number(process.env.FIELDOPS_TEST_API_PORT || 8026)
const apiBase = `http://127.0.0.1:${port}`
const server = spawn(python, ['-B', '-m', 'uvicorn', 'day9_server:create_app', '--factory', '--app-dir', 'tests', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
  cwd: backendDir, env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', () => {})
const runId = randomUUID().slice(0, 8)
const passes = []
const pass = label => { passes.push(label); console.log(`PASS ${label}`) }
const runtimeErrors = []
let frontend, browser, page

async function request(path, { actor, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  })
  assert.equal(response.status, expected, `${method} ${path} HTTP status`)
  return response.status === 204 ? null : response.json()
}
async function account(label) {
  const values = { name: `QA ${label} ${runId}`, email: `qa-browser-${label}-${runId}@example.com`, password: `A!${randomUUID()}${randomUUID()}` }
  const user = await request('/auth/register', { method: 'POST', body: values, expected: 201 })
  const login = await request('/auth/login', { method: 'POST', body: { email: values.email, password: values.password } })
  return { ...values, id: user.id, token: login.access_token }
}

try {
  let health
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { health = await request('/health'); break } catch { await new Promise(done => setTimeout(done, 200)) }
    if (server.exitCode !== null) throw new Error('Isolated test API exited before startup')
  }
  assert.equal(health?.test_database, databaseUrl.pathname.slice(1), 'Verify exact disposable test database before writes')
  assert.equal(health?.database_type, 'postgresql')
  const owner = await account('owner')
  const applicant = await account('applicant')
  const organization = await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: {
    name: `${runId} Notification workspace`, organization_type: 'NGO', country: 'LB', city: 'Beirut',
    is_discoverable: true, allow_possible_duplicate: true,
  } })
  const other = await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: {
    name: `${runId} Other workspace`, organization_type: 'NGO', country: 'LB', city: 'Byblos', allow_possible_duplicate: true,
  } })
  const namesakeName = `${runId} QA namesake organization`
  const namesakes = []
  for (const city of ['Beirut', 'Jounieh']) namesakes.push(await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: {
    name: namesakeName, organization_type: 'NGO', country: 'LB', city, is_discoverable: true, allow_possible_duplicate: true,
  } }))
  const applicantRequest = await request(`/organizations/${organization.id}/join-requests`, { actor: applicant, method: 'POST', body: {}, expected: 201 })
  await request(`/organizations/${organization.id}/join-requests`, { actor: applicant, method: 'POST', body: {}, expected: 200 })
  frontend = await preview({ root: frontendDir, preview: { host: '127.0.0.1', port: 5196, strictPort: true, proxy: { '/backend': { target: apiBase, changeOrigin: true, rewrite: path => path.replace(/^\/backend/, '') } } } })
  browser = await chromium.launch({ channel: process.env.FIELDOPS_BROWSER_CHANNEL || 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'Asia/Beirut' })
  page = await context.newPage()
  page.on('pageerror', error => runtimeErrors.push(error.message))
  const base = 'http://127.0.0.1:5196'
  const signupValues = { name: `QA Signup ${runId}`, email: `qa-browser-signup-${runId}@example.com`, password: 'Abcdefgh!1' }
  assert.equal(signupValues.password.length, 10)
  await page.goto(`${base}/signup`)
  await page.getByLabel('Full name', { exact: true }).fill(signupValues.name)
  await page.getByLabel('Email address', { exact: true }).fill(signupValues.email)
  for (const [password, feedback] of [['Abcdefg!1', /10/], ['abcdefgh!1', /uppercase/i], ['Abcdefgh12', /special/i]]) {
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.locator('#signup-password-error').filter({ hasText: feedback }).waitFor()
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('aria-invalid'), 'true')
  }
  await page.getByLabel('Password', { exact: true }).fill(signupValues.password)
  await page.getByLabel('Confirm password', { exact: true }).fill(signupValues.password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByRole('heading', { name: 'Welcome to FieldOps Pro', exact: true }).waitFor()
  pass('Signup gives field-level minimum/uppercase/special feedback and accepts an exactly ten-character password')
  const signupLogin = await request('/auth/login', { method: 'POST', body: { email: signupValues.email, password: signupValues.password } })
  const signedUp = { ...signupValues, token: signupLogin.access_token }
  await page.getByRole('button', { name: /^Create a new organization/ }).click()
  const customName = `${runId} Custom community organization`
  await page.getByLabel('Organization name *', { exact: true }).fill(customName)
  await page.getByLabel('Organization type *', { exact: true }).selectOption('Other')
  await page.getByLabel('City / area *', { exact: true }).fill('Beirut')
  await page.setViewportSize({ width: 390, height: 844 })
  const country = page.getByRole('combobox', { name: 'Country *', exact: true })
  await country.fill('Lebanon')
  await country.press('ArrowDown')
  await country.press('Enter')
  assert.equal(await country.inputValue(), 'Lebanon')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: /organization type/i }).waitFor()
  await page.getByLabel('Specify organization type', { exact: true }).fill('Community Association')
  await page.getByLabel('Organization type *', { exact: true }).selectOption('Sports Club')
  assert.equal(await page.getByLabel('Specify organization type', { exact: true }).count(), 0)
  await page.getByLabel('Organization type *', { exact: true }).selectOption('Other')
  assert.equal(await page.getByLabel('Specify organization type', { exact: true }).inputValue(), '')
  await page.getByLabel('Specify organization type', { exact: true }).fill('  Community   Association  ')
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  const custom = (await request('/organizations', { actor: signedUp })).find(item => item.name === customName)
  assert.ok(custom)
  assert.equal(custom.organization_type_other, 'Community Association')
  assert.equal(custom.country, 'LB')
  pass('Other type is required, clears when hidden, normalizes and persists; the searchable Lebanon picker supports keyboard and mobile')
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto(`${base}/onboarding?view=join`)
  await page.getByLabel('Organization name', { exact: true }).fill(namesakeName)
  await page.getByRole('button', { name: 'Search organizations', exact: true }).click()
  await page.getByRole('heading', { name: namesakeName, exact: true }).first().waitFor()
  assert.equal(await page.getByRole('heading', { name: namesakeName, exact: true }).count(), 2)
  for (const namesake of namesakes) assert.equal(await page.getByText(namesake.id, { exact: false }).count(), 1)
  const discovery = await request(`/organizations/discover?q=${encodeURIComponent(namesakeName)}`, { actor: signedUp })
  assert.equal(new Set(discovery.matches.map(item => item.id)).size, discovery.matches.length)
  pass('Distinct namesake UUIDs remain separate visible cards with workspace references and no repeated UUID results')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto(`${base}/login`)
  await page.getByLabel('Email address', { exact: true }).fill(owner.email)
  await page.getByLabel('Password', { exact: true }).fill(owner.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // Sign-in may restore the protected onboarding URL from the sign-out step.
  // Verify the new identity before navigating to the notification workspace.
  await page.getByText(owner.email, { exact: true }).waitFor()
  await page.goto(`${base}/dashboard`)
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
  await page.getByLabel('Select organization').selectOption(other.id)
  const bell = page.getByRole('button', { name: /^Notifications/ })
  await bell.filter({ has: page.locator('span', { hasText: '1' }) }).waitFor()
  await bell.click()
  const feed = page.getByRole('region', { name: 'Notifications', exact: true })
  await feed.getByText(applicant.name, { exact: true }).waitFor()
  assert.equal(await feed.getByRole('listitem').count(), 1)
  assert.equal(await feed.getByText(organization.name, { exact: true }).count(), 1)
  await feed.getByRole('button', { name: 'Mark read', exact: true }).click()
  await feed.getByRole('button', { name: 'Mark unread', exact: true }).waitFor()
  assert.equal((await request('/notifications', { actor: owner })).unread_count, 0)
  await feed.getByRole('button', { name: 'Mark unread', exact: true }).click()
  await feed.getByRole('button', { name: 'Mark read', exact: true }).waitFor()
  assert.equal((await request('/notifications', { actor: owner })).unread_count, 1)
  await feed.getByRole('link', { name: 'View join request', exact: true }).click()
  await page.getByRole('heading', { name: 'Join requests', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Select organization').inputValue(), organization.id)
  assert.equal(new URL(page.url()).searchParams.get('request'), applicantRequest.id)
  pass('Owner bell shows one deduplicated request, persists read/unread, and opens the correct organization Join Requests page')

  await page.getByRole('article').filter({ hasText: applicant.email }).getByRole('button', { name: /^Approve / }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve request', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'was approved' }).waitFor()
  await bell.click()
  await feed.getByRole('button', { name: 'Refresh notifications', exact: true }).click()
  await feed.getByText(/Request approved/).waitFor()
  assert.equal(await feed.getByRole('listitem').count(), 1)
  await page.keyboard.press('Escape')
  assert.equal(await feed.count(), 0)
  assert.equal(await bell.evaluate(element => element === document.activeElement), true)
  pass('Review updates the persisted notification status and Escape returns keyboard focus to the bell')

  await page.setViewportSize({ width: 390, height: 844 })
  await bell.click()
  await feed.waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  const bounds = await feed.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  await feed.getByRole('button', { name: 'Close notifications', exact: true }).click()
  pass('Mobile notification feed stays within the viewport and exposes accessible controls')
  await page.setViewportSize({ width: 1440, height: 1050 })

  await page.getByRole('button', { name: 'Organization profile', exact: true }).click()
  await page.getByRole('button', { name: 'Archive organization', exact: true }).click()
  const confirmation = page.getByRole('dialog')
  assert.equal(await confirmation.getByRole('button', { name: 'Confirm archive', exact: true }).isEnabled(), false)
  await confirmation.getByLabel('Type the organization name to confirm', { exact: true }).fill('Wrong name')
  assert.equal(await confirmation.getByRole('button', { name: 'Confirm archive', exact: true }).isEnabled(), false)
  await confirmation.getByLabel('Type the organization name to confirm', { exact: true }).fill(organization.name)
  await confirmation.getByRole('button', { name: 'Confirm archive', exact: true }).click()
  await page.getByRole('button', { name: 'Restore organization', exact: true }).waitFor()
  assert.ok((await request(`/organizations/${organization.id}`, { actor: owner })).archived_at)
  const found = await request(`/organizations/discover?q=${encodeURIComponent(organization.name)}`, { actor: applicant })
  assert.equal(found.matches.some(item => item.id === organization.id), false)
  await request('/api/v1/participants', { actor: owner, method: 'POST', body: { organization_id: organization.id, full_name: 'Blocked browser test mutation' }, expected: 409 })
  await page.goto(`${base}/dashboard`)
  await page.getByRole('heading', { name: organization.name, exact: true }).waitFor()
  await page.getByRole('link', { name: 'Organization settings', exact: true }).click()
  await page.getByRole('button', { name: 'Restore organization', exact: true }).click()
  await confirmation.getByLabel('Type the organization name to confirm', { exact: true }).fill(organization.name)
  await confirmation.getByRole('button', { name: 'Confirm restoration', exact: true }).click()
  await page.getByRole('button', { name: 'Archive organization', exact: true }).waitFor()
  assert.equal((await request(`/organizations/${organization.id}`, { actor: owner })).archived_at, null)
  const history = await request(`/organizations/${organization.id}/archive-history`, { actor: owner })
  assert.deepEqual(new Set(history.map(item => item.action)), new Set(['archive', 'restore']))
  assert.ok((await request(`/organizations/${organization.id}/members`, { actor: owner })).some(item => item.user_id === applicant.id))
  pass('Archive requires the exact name, hides discovery, blocks new writes, preserves membership/history, and restores safely')

  assert.deepEqual(runtimeErrors, [])
  pass('No browser runtime errors')
  console.log(`QA IMPROVEMENTS BROWSER RESULT: ${passes.length} scenarios passed; data confined to ${health.test_database}`)
} catch (error) {
  if (page) console.error('QA browser failure:', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 2200))
  if (process.env.FIELDOPS_TEST_SCREENSHOT_DIR && page) await page.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'qa-improvements-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  if (browser) await browser.close()
  if (frontend) await new Promise(done => frontend.httpServer.close(done))
  server.kill()
  await new Promise(done => { if (server.exitCode !== null) return done(); server.once('exit', done); setTimeout(done, 2000) })
}
