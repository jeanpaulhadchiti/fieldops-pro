import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function source(relativePath, dependencies = {}) {
  const input = readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  const dependency = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('.')) throw new Error(`Unexpected source dependency: ${name}`)
    return require(name)
  }
  new Function('require', 'module', 'exports', outputText)(dependency, module, module.exports)
  return module.exports
}
class ApiError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail }
}
const types = source('features/onboarding/types.ts')
const countryData = JSON.parse(readFileSync(new URL('../src/data/countries.json', import.meta.url), 'utf8'))
const countries = source('data/countries.ts', { './countries.json': countryData })
const schemas = source('features/onboarding/schemas.ts', { './types': types, '../../data/countries': countries })
const keys = source('features/onboarding/queryKeys.ts').onboardingKeys
const { isCurrentLoginAttempt } = source('features/auth/loginAttempt.ts')
const signup = () => ({ name: 'New Person', email: 'person@example.com', password: 'A long unique passphrase!', confirmPassword: 'A long unique passphrase!' })
const draft = () => ({ name: 'Distinct Group', organization_type: 'Scout Group', country: 'Lebanon', city: 'Beirut', description: '', is_discoverable: false })
const match = () => ({ id: randomUUID(), name: 'Distinct Group', organization_type: 'Scout Group', country: 'Lebanon', city: 'Beirut', match_kind: 'exact' })
const org = values => ({ ...values, description: values.description || null, id: randomUUID(), created_at: '2027-01-01T10:00:00Z' })
const request = organizationId => ({ id: randomUUID(), organization_id: organizationId, organization_name: 'Distinct Group', status: 'pending', message: null, created_at: '2027-01-01T10:00:00Z', reviewed_at: null, membership_active: false })
const api = responder => source('features/onboarding/api.ts', { '../../services/api': { apiRequest: responder, ApiError }, './types': types, '../../data/countries': countries })

test('signup validates required fields, password boundaries, and confirmation without changing the password', () => {
  for (const password of ['short', 'x'.repeat(129), ' '.repeat(12)]) assert.equal(schemas.signupSchema.safeParse({ ...signup(), password, confirmPassword: password }).success, false)
  for (const values of [{ ...signup(), name: '  ' }, { ...signup(), name: 'x'.repeat(121) }, { ...signup(), email: 'bad' }, { ...signup(), confirmPassword: 'Different password' }]) assert.equal(schemas.signupSchema.safeParse(values).success, false)
  const password = '  Long passphrase preserved!  '
  const parsed = schemas.signupSchema.parse({ ...signup(), name: '  New\t Person  ', email: ' person@example.com ', password, confirmPassword: password })
  assert.equal(parsed.name, 'New Person')
  assert.equal(parsed.email, 'person@example.com')
  assert.equal(parsed.password, password)
})

test('organization form requires location and bounded metadata while keeping private discovery as a real boolean', () => {
  assert.equal(schemas.organizationDraftSchema.parse(draft()).is_discoverable, false)
  assert.equal(schemas.organizationDraftSchema.parse({ ...draft(), name: '  Distinct\n Group ' }).name, 'Distinct Group')
  for (const values of [{ ...draft(), country: ' ' }, { ...draft(), city: '' }, { ...draft(), organization_type: 'Owner' }, { ...draft(), description: 'x'.repeat(2001) }, { ...draft(), is_discoverable: 'false' }]) assert.equal(schemas.organizationDraftSchema.safeParse(values).success, false)
})

test('discovery and join forms enforce bounded, deliberate searches and messages', () => {
  const values = { q: 'A group', organization_type: '', country: '', city: '' }
  for (const q of ['', 'ab', 'x'.repeat(151)]) assert.equal(schemas.discoveryFormSchema.safeParse({ ...values, q }).success, false)
  assert.equal(schemas.discoveryFormSchema.parse({ ...values, q: '  A\t group  ' }).q, 'A group')
  assert.equal(schemas.joinMessageSchema.safeParse({ message: 'x'.repeat(1001) }).success, false)
  assert.equal(schemas.joinMessageSchema.parse({ message: '  Hello team  ' }).message, 'Hello team')
})

test('signup reuses the real registration endpoint without submitting confirmation or role fields', async () => {
  const values = signup()
  let sent
  const transport = api(async (path, options) => { sent = { path, options }; return { id: randomUUID(), name: values.name, email: values.email, created_at: '2027-01-01T10:00:00Z' } })
  await transport.signup(values)
  assert.equal(sent.path, '/auth/register')
  assert.equal(sent.options.auth, false)
  assert.deepEqual(sent.options.body, { name: values.name, email: values.email, password: values.password })
})

test('discovery sends encoded filters, remains authenticated, and retains only public card fields', async () => {
  const card = match()
  let sent
  const transport = api(async (path, options) => { sent = { path, options }; return { matches: [{ ...card, administrator_email: 'must-not-render@example.com', members: [] }] } })
  const cards = await transport.discoverOrganizations({ q: 'Group & Team', organization_type: 'Scout Group', country: 'Lebanon', city: 'Beirut' })
  const url = new URL(sent.path, 'http://test.local')
  assert.equal(url.pathname, '/organizations/discover')
  assert.equal(url.searchParams.get('q'), 'Group & Team')
  assert.equal(url.searchParams.get('organization_type'), 'Scout Group')
  assert.equal(url.searchParams.get('country'), 'Lebanon')
  assert.equal(url.searchParams.get('city'), 'Beirut')
  assert.notEqual(sent.options.auth, false)
  assert.deepEqual(cards, [card])
  await assert.rejects(api(async () => ({ matches: Array.from({ length: 11 }, match) })).discoverOrganizations({ q: 'Group' }))
  assert.deepEqual(await api(async () => ({ matches: [card, card] })).discoverOrganizations({ q: 'Group' }), [card])
})

test('duplicate warning parsing accepts only the documented 409 public-card response', () => {
  const transport = api(async () => { throw new Error('Unexpected request') })
  const cards = [match()]
  const detail = { code: 'possible_duplicate', message: 'Review the matches.', matches: cards }
  assert.deepEqual(transport.possibleDuplicateMatches(new ApiError('Duplicate', 409, detail)), cards)
  for (const error of [new Error('Duplicate'), new ApiError('Duplicate', 403, detail), new ApiError('Duplicate', 409, { ...detail, code: 'other' }), new ApiError('Duplicate', 409, { ...detail, matches: [{ id: 'malformed' }] })]) assert.equal(transport.possibleDuplicateMatches(error), null)
})

test('organization creation sends explicit duplicate confirmation and validates the actual saved metadata', async () => {
  const values = draft()
  let sent
  const transport = api(async (path, options) => { sent = { path, options }; return org(values) })
  await transport.createOrganization(values)
  assert.equal(sent.path, '/organizations')
  assert.equal(sent.options.body.allow_possible_duplicate, false)
  assert.equal(sent.options.body.description, null)
  assert.equal('role' in sent.options.body, false)
  await transport.createOrganization(values, true)
  assert.equal(sent.options.body.allow_possible_duplicate, true)
  await assert.rejects(api(async () => ({ ...org(values), city: 'Different city' })).createOrganization(values), /could not be verified/)
})

test('join submission derives identity from the session and verifies the returned organization and pending status', async () => {
  const organizationId = randomUUID()
  let sent
  const transport = api(async (path, options) => { sent = { path, options }; return request(organizationId) })
  await transport.requestToJoin(organizationId, '')
  assert.equal(sent.path, `/organizations/${organizationId}/join-requests`)
  assert.deepEqual(sent.options.body, { message: null })
  for (const received of [{ ...request(randomUUID()) }, { ...request(organizationId), status: 'approved' }, { ...request(organizationId), membership_active: true }]) await assert.rejects(api(async () => received).requestToJoin(organizationId, ''), /could not be verified/)
})

test('own history preserves real statuses and uses bounded pagination with session-scoped query keys', async () => {
  const organizationId = randomUUID()
  const rows = ['pending', 'approved', 'rejected'].map(status => ({ ...request(organizationId), status }))
  let sent
  const received = await api(async path => { sent = path; return rows }).getOwnJoinRequests(2)
  assert.equal(sent, '/organization-join-requests/mine?page=2&page_size=20')
  assert.deepEqual(received.map(row => row.status), ['pending', 'approved', 'rejected'])
  assert.notDeepEqual(keys.ownRequests('user-a', 1), keys.ownRequests('user-b', 1))
  assert.notDeepEqual(keys.discovery('user-a', { q: 'Group' }), keys.discovery('user-b', { q: 'Group' }))
})

test('network and server uncertainty requires review while deterministic validation failures do not', () => {
  const transport = api(async () => { throw new Error('Unexpected request') })
  for (const error of [new Error('Connection lost'), new ApiError('Server', 500), new ApiError('Malformed response', 502)]) assert.equal(transport.isUncertainWrite(error), true)
  for (const status of [400, 403, 409, 422, 429]) assert.equal(transport.isUncertainWrite(new ApiError('Rejected', status)), false)
})

test('a delayed login cannot replace a newer login, sign-out, session, or aborted signup', () => {
  const attempt = { id: 1, sessionVersion: 7 }
  assert.equal(isCurrentLoginAttempt(attempt, 1, 7, false), true)
  assert.equal(isCurrentLoginAttempt(attempt, 2, 7, false), false, 'A newer attempt wins before either response is applied')
  assert.equal(isCurrentLoginAttempt(attempt, 1, 8, false), false, 'Sign-out and other session changes invalidate the old response')
  assert.equal(isCurrentLoginAttempt(attempt, 1, 7, true), false, 'Leaving signup/sign-in aborts the old attempt')
})


test('QA password policy accepts exactly ten characters and rejects missing uppercase or special characters', () => {
  for (const password of ['Abcdefgh!1', 'Abcdefgh😀1', 'A!'.padEnd(128, 'x')]) assert.equal(schemas.signupSchema.safeParse({ ...signup(), password, confirmPassword: password }).success, true)
  for (const password of ['Abcdefg!1', 'abcdefgh!1', 'Abcdefghi1', ' '.repeat(10), 'A!'.padEnd(129, 'x'), 'A😀😀😀😀😀😀😀😀']) assert.equal(schemas.signupSchema.safeParse({ ...signup(), password, confirmPassword: password }).success, false)
})

test('Other organization type is required, normalized, bounded, and cleared for an enumerated type', () => {
  assert.equal(schemas.organizationDraftSchema.safeParse({ ...draft(), organization_type: 'Other' }).success, false)
  const parsed = schemas.organizationDraftSchema.parse({ ...draft(), organization_type: 'Other', organization_type_other: '  Parish\n Youth   Group ' })
  assert.equal(parsed.organization_type_other, 'Parish Youth Group')
  assert.equal(schemas.organizationDraftSchema.parse({ ...draft(), organization_type_other: 'stale value' }).organization_type_other, '')
  assert.equal(schemas.organizationDraftSchema.safeParse({ ...draft(), organization_type: 'Other', organization_type_other: 'x'.repeat(101) }).success, false)
})

test('bundled searchable countries include all ISO249 codes and preserve historical display strings', () => {
  assert.equal(countries.countries.length, 249)
  assert.equal(new Set(countries.countries.map(country => country.code)).size, 249)
  assert.equal(countries.countryCode(' lebanon '), 'LB')
  assert.equal(countries.countryCode('lb'), 'LB')
  assert.equal(countries.countryName('LB'), 'Lebanon')
  assert.equal(countries.countryName('Historical territory'), 'Historical territory')
  assert.equal(countries.searchCountries('Leban')[0].code, 'LB')
  assert.equal(schemas.organizationDraftSchema.parse(draft()).country, 'LB')
  assert.equal(schemas.organizationDraftSchema.safeParse({ ...draft(), country: 'Made up country' }).success, false)
})

test('namesake cards remain distinct by UUID while duplicate UUIDs appear only once', async () => {
  const first = match()
  const second = { ...first, id: randomUUID() }
  const cards = await api(async () => ({ matches: [first, first, second] })).discoverOrganizations({ q: first.name })
  assert.deepEqual(cards.map(card => card.id), [first.id, second.id])
})
