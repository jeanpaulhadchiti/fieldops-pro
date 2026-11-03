/** Real browser -> Vite -> FastAPI -> disposable PostgreSQL Day 9.5 checks. */
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
const port = Number(process.env.FIELDOPS_TEST_API_PORT || 8025)
const apiBase = `http://127.0.0.1:${port}`
const server = spawn(python, ['-B', '-m', 'uvicorn', 'day9_server:create_app', '--factory', '--app-dir', 'tests', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
  cwd: backendDir, env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', () => {})
const runId = randomUUID().slice(0, 8)
const passes = []
const pass = label => { passes.push(label); console.log(`PASS ${label}`) }
const runtimeErrors = []
let frontend, browser, failurePage

async function request(path, { actor, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method, headers: { ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  })
  assert.equal(response.status, expected, `${method} ${path} HTTP status`)
  return response.status === 204 ? null : response.json()
}
async function account(label) {
  const values = { name: `Onboarding ${label} ${runId}`, email: `onboarding-browser-${label}-${runId}@example.com`, password: 'A!' + randomUUID() + randomUUID() }
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
  assert.equal(health?.test_database, databaseUrl.pathname.slice(1), 'Verify test database identity before any writes')
  assert.equal(health?.database_type, 'postgresql')
  const owner = await account('owner')
  const publicName = `${runId} Groupe Sainte Ríta`
  const publicOrg = await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: {
    name: publicName, organization_type: 'Scout Group', country: 'Lebanon', city: 'Jounieh',
    description: 'Private internal description', is_discoverable: true, allow_possible_duplicate: true,
  } })
  const privateOrg = await request('/organizations', { actor: owner, method: 'POST', expected: 201, body: { name: `${runId} confidential unit`, is_discoverable: false } })
  frontend = await preview({ root: frontendDir, preview: { host: '127.0.0.1', port: 5195, strictPort: true, proxy: { '/backend': { target: apiBase, changeOrigin: true, rewrite: path => path.replace(/^\/backend/, '') } } } })
  browser = await chromium.launch({ channel: process.env.FIELDOPS_BROWSER_CHANNEL || 'chrome', headless: true })
  const base = 'http://127.0.0.1:5195'
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'Asia/Beirut' })
  const page = await context.newPage()
  failurePage = page
  page.on('pageerror', error => runtimeErrors.push(error.message))
  const heading = (name, target = page) => target.getByRole('heading', { name, exact: true })
  async function login(target, actor) {
    await heading('Welcome back', target).waitFor()
    await target.getByLabel('Email address', { exact: true }).fill(actor.email)
    await target.getByLabel('Password', { exact: true }).fill(actor.password)
    await target.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  const applicantValues = { name: `Applicant ${runId}`, email: `onboarding-browser-applicant-${runId}@example.com`, password: 'A!' + randomUUID() + randomUUID() }
  await page.goto(`${base}/signup`)
  await heading('Create your account').waitFor()
  await page.getByLabel('Full name', { exact: true }).fill(applicantValues.name)
  await page.getByLabel('Email address', { exact: true }).fill(applicantValues.email)
  await page.getByLabel('Password', { exact: true }).fill(applicantValues.password)
  await page.getByLabel('Confirm password', { exact: true }).fill('different password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Passwords must match.' }).waitFor()
  await page.getByLabel('Confirm password', { exact: true }).fill(applicantValues.password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await heading('Welcome to FieldOps Pro').waitFor()
  const applicantLogin = await request('/auth/login', { method: 'POST', body: { email: applicantValues.email, password: applicantValues.password } })
  const applicant = { ...applicantValues, token: applicantLogin.access_token }
  assert.deepEqual(await request('/organizations', { actor: applicant }), [])
  await page.reload()
  await heading('Welcome to FieldOps Pro').waitFor()
  pass('public signup validates confirmation, authenticates through the existing API, and refreshes into onboarding with no inherited access')

  await page.getByRole('button', { name: /^Create a new organization/ }).click()
  const ownName = `${runId} Distinct sports team`
  await page.getByLabel('Organization name *', { exact: true }).fill(ownName)
  await page.getByLabel('Organization type *', { exact: true }).selectOption('Sports Club')
  await page.getByLabel('Country *', { exact: true }).fill('Lebanon')
  await page.getByLabel('Country *', { exact: true }).press('ArrowDown')
  await page.getByLabel('Country *', { exact: true }).press('Enter')
  await page.getByLabel('City / area *', { exact: true }).fill('Beirut')
  const multilineDescription = 'Local operations team.\n  Training and sports activities.'
  await page.getByLabel('Description', { exact: true }).fill(multilineDescription)
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await heading('Dashboard').waitFor()
  const owned = (await request('/organizations', { actor: applicant })).find(item => item.name === ownName)
  assert.ok(owned)
  assert.equal(owned.is_discoverable, false)
  assert.equal(owned.description, multilineDescription)
  await page.reload()
  await heading('Dashboard').waitFor()
  assert.equal(await page.getByLabel('Select organization').inputValue(), owned.id)
  const ownMembers = await request(`/organizations/${owned.id}/members`, { actor: applicant })
  assert.equal(ownMembers.find(item => item.email === applicant.email)?.role, 'Owner')
  pass('organization form creates a distinct private workspace, assigns Owner on the server, and persists selection after refresh')

  await page.goto(`${base}/onboarding?view=join`)
  await page.getByLabel('Organization name', { exact: true }).fill(`${runId} GROUPE SAINTE RITA`)
  await page.getByRole('button', { name: 'Search organizations', exact: true }).click()
  await page.getByRole('button', { name: 'Request to join', exact: true }).waitFor()
  assert.equal(await page.getByText(owner.email, { exact: true }).count(), 0)
  assert.equal(await page.getByText('Private internal description', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Request to join', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Message (optional)').fill('I coordinate the local scout activities.')
  await page.getByRole('dialog').getByRole('button', { name: 'Send join request', exact: true }).click()
  await page.getByText('Pending', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('Pending', { exact: true }).waitFor()
  assert.equal((await request('/organizations', { actor: applicant })).some(item => item.id === publicOrg.id), false)
  await request(`/organizations/${publicOrg.id}/members`, { actor: applicant, expected: 404 })
  pass('authenticated accent-insensitive discovery exposes public cards only, and a confirmed pending request grants no organization access')

  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'Asia/Beirut' })
  const ownerPage = await ownerContext.newPage()
  ownerPage.on('pageerror', error => runtimeErrors.push(error.message))
  await ownerPage.goto(`${base}/settings/members`)
  await login(ownerPage, owner)
  await heading('Organization settings', ownerPage).waitFor()
  await ownerPage.getByLabel('Select organization').selectOption(publicOrg.id)
  await heading('Join requests', ownerPage).waitFor()
  const application = ownerPage.getByRole('article').filter({ hasText: applicant.email })
  await application.getByRole('heading', { name: applicant.name, exact: true }).waitFor()
  await application.getByRole('button', { name: /^Approve / }).click()
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Approve request', exact: true }).click()
  await ownerPage.getByRole('status').filter({ hasText: 'was approved' }).waitFor()
  await ownerPage.getByLabel('Request status').selectOption('approved')
  await ownerPage.getByRole('article').filter({ hasText: applicant.email }).getByText('Approved', { exact: true }).waitFor()
  await ownerPage.reload()
  await ownerPage.getByLabel('Request status').selectOption('approved')
  await ownerPage.getByRole('article').filter({ hasText: applicant.email }).waitFor()
  const memberRows = await request(`/organizations/${publicOrg.id}/members`, { actor: owner })
  assert.equal(memberRows.find(item => item.email === applicant.email)?.role, 'Member')
  pass('authorized Owner reviews applicant identity and message, confirms approval, and persists exactly one ordinary Member membership')

  await page.reload()
  await page.getByText('Approved', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Open organization', exact: true }).click()
  await heading('Dashboard').waitFor()
  assert.equal(await page.getByLabel('Select organization').inputValue(), publicOrg.id)
  assert.equal(await page.getByRole('link', { name: 'Settings', exact: true }).count(), 0)
  await page.goto(`${base}/settings/members`)
  await heading('Administration access required').waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Join requests', exact: true }).count(), 0)
  await request(`/organizations/${publicOrg.id}/join-requests`, { actor: applicant, expected: 403 })
  await page.reload()
  await heading('Administration access required').waitFor()
  pass('approved applicant refreshes accurate status, enters the authorized organization, and remains unable to review applications')

  const rejected = await account('rejected')
  const rejectedRequest = await request(`/organizations/${publicOrg.id}/join-requests`, { actor: rejected, method: 'POST', body: { message: 'Please review this separate application.' }, expected: 201 })
  await ownerPage.getByLabel('Request status').selectOption('pending')
  await ownerPage.getByRole('button', { name: 'Refresh requests', exact: true }).click()
  await ownerPage.getByRole('article').filter({ hasText: rejected.email }).getByRole('button', { name: /^Reject / }).click()
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Reject request', exact: true }).click()
  await ownerPage.getByRole('status').filter({ hasText: 'was rejected' }).waitFor()
  assert.equal((await request('/organization-join-requests/mine', { actor: rejected })).find(item => item.id === rejectedRequest.id)?.status, 'rejected')
  assert.deepEqual(await request('/organizations', { actor: rejected }), [])
  pass('confirmed rejection is saved and the rejected user receives no membership')

  await page.goto(`${base}/onboarding?view=create`)
  await page.getByLabel('Organization name *', { exact: true }).fill(publicName)
  await page.getByLabel('Organization type *', { exact: true }).selectOption('NGO')
  await page.getByLabel('Country *', { exact: true }).fill('France')
  await page.getByLabel('Country *', { exact: true }).press('ArrowDown')
  await page.getByLabel('Country *', { exact: true }).press('Enter')
  await page.getByLabel('City / area *', { exact: true }).fill('Paris')
  await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  await heading('A similar organization already exists').waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Create distinct organization', exact: true }).click()
  await heading('Dashboard').waitFor()
  const namesakes = (await request('/organizations', { actor: applicant })).filter(item => item.name === publicName)
  assert.equal(namesakes.length, 2)
  const distinct = namesakes.find(item => item.id !== publicOrg.id)
  assert.equal(distinct.city, 'Paris')
  const oldOwners = await request(`/organizations/${publicOrg.id}/members`, { actor: owner })
  assert.equal(oldOwners.find(item => item.role === 'Owner')?.email, owner.email)
  pass('possible-duplicate warning requires explicit confirmation and permits a legitimate namesake without changing the original Owner')

  // Hold a real organizations response while the user selects a different
  // workspace. A stale refresh must not steal the newer selection afterwards.
  await page.goto(`${base}/onboarding`)
  await heading('Welcome to FieldOps Pro').waitFor()
  await page.getByRole('button', { name: 'Open organization', exact: true }).waitFor()
  let releaseOrganizations, startedOrganizations, finishOrganizations
  const organizationsStarted = new Promise(done => { startedOrganizations = done })
  const organizationsReleased = new Promise(done => { releaseOrganizations = done })
  const organizationsFinished = new Promise(done => { finishOrganizations = done })
  await page.route('**/backend/organizations', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    startedOrganizations()
    await organizationsReleased
    try { await route.fulfill({ response }) } catch { /* A superseded query may be aborted during the switch. */ }
    finally { finishOrganizations() }
  })
  const open = page.getByRole('button', { name: 'Open organization', exact: true })
  await open.click()
  await organizationsStarted
  await page.getByLabel('Select organization').selectOption(owned.id)
  releaseOrganizations()
  await organizationsFinished
  await page.unroute('**/backend/organizations')
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByLabel('Select organization').inputValue(), owned.id)
  pass('a delayed organization refresh cannot override a workspace the user selected later')

  const staleContext = await browser.newContext()
  const stalePage = await staleContext.newPage()
  stalePage.on('pageerror', error => runtimeErrors.push(error.message))
  await stalePage.goto(`${base}/login`)
  await heading('Welcome back', stalePage).waitFor()
  let firstLogin = true, releaseLogin, startLogin
  const loginStarted = new Promise(done => { startLogin = done })
  const loginReleased = new Promise(done => { releaseLogin = done })
  await stalePage.route('**/backend/auth/login', async route => {
    if (!firstLogin) return route.continue()
    firstLogin = false
    const response = await route.fetch()
    startLogin()
    await loginReleased
    // SPA navigation aborted the old fetch; fulfilling an aborted route can
    // legitimately fail, but it must never overwrite the newer session.
    await route.fulfill({ response }).catch(() => {})
  })
  await login(stalePage, owner)
  await loginStarted
  await stalePage.getByRole('link', { name: 'Create an account', exact: true }).click()
  await heading('Create your account', stalePage).waitFor()
  await stalePage.getByRole('link', { name: 'Sign in', exact: true }).click()
  await login(stalePage, applicant)
  await heading('Dashboard', stalePage).waitFor()
  releaseLogin()
  await stalePage.unroute('**/backend/auth/login')
  await stalePage.waitForLoadState('networkidle')
  const signedInEmail = await stalePage.evaluate(async () => {
    const token = sessionStorage.getItem('fieldops.access-token')
    const response = await fetch('/backend/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    return (await response.json()).email
  })
  assert.equal(signedInEmail, applicant.email)
  pass('leaving an in-flight sign-in and completing another login cannot restore the older account session')
  await staleContext.close()

  await ownerPage.getByRole('button', { name: 'Organization profile', exact: true }).click()
  await heading('Organization profile', ownerPage).waitFor()
  await ownerPage.getByRole('checkbox', { name: /^Allow organization discovery/ }).uncheck()
  await ownerPage.getByRole('button', { name: 'Review settings', exact: true }).click()
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Save settings', exact: true }).click()
  await ownerPage.getByRole('status').filter({ hasText: 'Organization settings saved.' }).waitFor()
  const hidden = await request(`/organizations/discover?q=${encodeURIComponent(publicName)}`, { actor: rejected })
  assert.equal(hidden.matches.some(item => item.id === publicOrg.id), false)
  assert.equal(hidden.matches.some(item => item.id === privateOrg.id), false)
  await request(`/organizations/${publicOrg.id}/join-requests`, { actor: rejected, method: 'POST', body: {}, expected: 404 })
  pass('Owner can make discovery private with confirmation; existing data stays authorized and new searches/requests reveal no hidden organization')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/onboarding?view=join`)
  await heading('Welcome to FieldOps Pro').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('link', { name: 'Manage organizations', exact: true }).click()
  await heading('Welcome to FieldOps Pro').waitFor()
  if (process.env.FIELDOPS_TEST_SCREENSHOT_DIR) {
    await page.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'day95-onboarding-mobile.png'), fullPage: true })
    await ownerPage.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'day95-settings.png'), fullPage: true })
  }
  pass('mobile onboarding and organization navigation remain usable without horizontal overflow')
  assert.deepEqual(runtimeErrors, [])
  pass('no browser runtime errors')
  console.log(`DAY 9.5 BROWSER RESULT: ${passes.length} scenarios passed; data confined to ${health.test_database}`)
} catch (error) {
  if (process.env.FIELDOPS_TEST_SCREENSHOT_DIR && failurePage) await failurePage.screenshot({ path: resolve(process.env.FIELDOPS_TEST_SCREENSHOT_DIR, 'day95-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  if (browser) await browser.close()
  if (frontend) await new Promise(done => frontend.httpServer.close(done))
  server.kill()
  await new Promise(done => { if (server.exitCode !== null) return done(); server.once('exit', done); setTimeout(done, 2000) })
}
