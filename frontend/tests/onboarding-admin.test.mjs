import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function source(file, dependencies = {}) {
  const input = readFileSync(new URL(`../src/features/organizations/admin/${file}`, import.meta.url), 'utf8')
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

const types = source('types.ts')
const policies = source('policies.ts', { './types': types })
const orgId = randomUUID()
const userId = randomUUID()
const requestId = randomUUID()
const memberId = randomUUID()
const profile = () => ({ id: orgId, name: 'Field team', organization_type: 'Scout Group', country: 'Lebanon', city: 'Beirut', description: null, is_discoverable: false, created_at: '2027-01-01T10:00:00Z' })
const review = () => ({ id: requestId, organization_id: orgId, organization_name: 'Field team', user_id: userId, applicant_name: 'Example applicant', applicant_email: 'applicant@example.com', status: 'pending', message: null, created_at: '2027-01-01T10:00:00Z', reviewed_at: null, reviewed_by: null, membership_active: false })
const member = () => ({ id: memberId, user_id: userId, name: 'Example applicant', email: 'applicant@example.com', role: 'Member', status: 'active', created_at: '2027-01-01T10:00:00Z' })
const apiFor = responder => source('api.ts', { './types': types, './policies': policies, '../../../services/api': { apiRequest: responder } })

test('only Owner can grant Admin; Member, Viewer, and other roles cannot grant access', () => {
  assert.ok(policies.rolesAllowedFor('Owner').includes('Admin'))
  assert.deepEqual(policies.rolesAllowedFor('Admin'), ['Treasurer', 'Logistics', 'Member', 'Viewer'])
  for (const role of ['Member', 'Viewer', 'Treasurer', 'Logistics', '']) assert.deepEqual(policies.rolesAllowedFor(role), [])
  const copied = policies.rolesAllowedFor('Owner')
  copied.pop()
  assert.equal(policies.rolesAllowedFor('Owner').length, 5)
})

test('role controls preserve protected Owner, self, inactive, and peer Admin memberships', () => {
  const reviewer = randomUUID()
  assert.equal(policies.canChangeMemberRole('Owner', reviewer, member()), true)
  assert.equal(policies.canChangeMemberRole('Admin', reviewer, member()), true)
  for (const reviewerRole of ['Owner', 'Admin']) {
    assert.equal(policies.canChangeMemberRole(reviewerRole, reviewer, { ...member(), role: 'Owner' }), false)
    assert.equal(policies.canChangeMemberRole(reviewerRole, userId, member()), false)
    assert.equal(policies.canChangeMemberRole(reviewerRole, reviewer, { ...member(), status: 'inactive' }), false)
  }
  assert.equal(policies.canChangeMemberRole('Admin', reviewer, { ...member(), role: 'Admin' }), false)
  assert.equal(policies.canChangeMemberRole('Owner', reviewer, { ...member(), role: 'Admin' }), true)
  assert.equal(policies.canChangeMemberRole('Member', reviewer, member()), false)
})

test('profile validation normalizes names and optional location without changing discoverability or adding roles', () => {
  const values = policies.organizationProfileSchema.parse({ name: '  Groupe   Sainte Rita  ', organization_type: 'Scout Group', country: ' Lebanon ', city: '  ', description: '  Organization description  ', is_discoverable: false, role: 'Owner' })
  assert.deepEqual(policies.profilePayload(values), { name: 'Groupe Sainte Rita', organization_type_other: null, organization_type: 'Scout Group', country: 'Lebanon', city: null, description: 'Organization description', is_discoverable: false })
  for (const invalid of [{ ...values, name: '   ' }, { ...values, name: 'x'.repeat(151) }, { ...values, city: 'x'.repeat(101) }, { ...values, description: 'x'.repeat(2001) }, { ...values, organization_type: 'Unknown' }]) {
    assert.equal(policies.organizationProfileSchema.safeParse(invalid).success, false)
  }
  assert.equal(policies.memberAddSchema.safeParse({ email: 'not-an-email', role: 'Member' }).success, false)
  assert.equal(policies.memberAddSchema.safeParse({ email: 'a@example.com', role: 'Owner' }).success, false)
})

test('administration query keys isolate user, organization, status, and page', () => {
  const original = policies.administrationKeys.requests(userId, orgId, 'pending', 1)
  for (const changed of [policies.administrationKeys.requests(randomUUID(), orgId, 'pending', 1), policies.administrationKeys.requests(userId, randomUUID(), 'pending', 1), policies.administrationKeys.requests(userId, orgId, 'approved', 1), policies.administrationKeys.requests(userId, orgId, 'pending', 2)]) assert.notDeepEqual(changed, original)
  assert.deepEqual(policies.administrationKeys.members(userId, orgId), ['organization-members', userId, orgId])
})

test('profile calls preserve the real scoped endpoint and reject another organization response', async () => {
  const calls = []
  const api = apiFor(async (path, options) => { calls.push({ path, options }); return profile() })
  await api.getOrganizationProfile(orgId)
  await api.saveOrganizationProfile(orgId, { name: 'Field team', organization_type: 'Scout Group', country: '', city: '', description: '', is_discoverable: false })
  assert.equal(calls[0].path, `/organizations/${orgId}`)
  assert.equal(calls[1].path, `/organizations/${orgId}/settings`)
  assert.deepEqual(calls[1].options, { method: 'PATCH', body: { name: 'Field team', organization_type_other: null, organization_type: 'Scout Group', country: null, city: null, description: null, is_discoverable: false } })
  await assert.rejects(apiFor(async () => ({ ...profile(), id: randomUUID() })).getOrganizationProfile(orgId), /different organization/)
})

test('request listing uses bounded real pagination and rejects cross-organization or malformed applicant data', async () => {
  let requested
  const api = apiFor(async (path) => { requested = path; return [review()] })
  assert.equal((await api.getJoinRequests(orgId, 'pending', 2)).length, 1)
  const url = new URL(requested, 'https://fixture.invalid')
  assert.equal(url.pathname, `/organizations/${orgId}/join-requests`)
  assert.equal(url.searchParams.get('page'), '2')
  assert.equal(url.searchParams.get('page_size'), '25')
  assert.equal(url.searchParams.get('status'), 'pending')
  await api.getJoinRequests(orgId, 'pending', 1, undefined, requestId)
  assert.equal(new URL(requested, 'https://fixture.invalid').searchParams.get('request_id'), requestId)
  await assert.rejects(apiFor(async () => [{ ...review(), id: randomUUID() }]).getJoinRequests(orgId, 'pending', 1, undefined, requestId), /notification/)
  await assert.rejects(apiFor(async () => [{ ...review(), organization_id: randomUUID() }]).getJoinRequests(orgId, '', 1), /selected organization/)
  await assert.rejects(apiFor(async () => [{ ...review(), applicant_email: 'invalid' }]).getJoinRequests(orgId, '', 1), /inconsistent organization/)
})

test('review sends only the decision and validates the returned request, scope, and outcome', async () => {
  for (const decision of ['approve', 'reject']) {
    let call
    const api = apiFor(async (path, options) => { call = { path, options }; return { ...review(), status: decision === 'approve' ? 'approved' : 'rejected', reviewed_at: '2027-01-01T11:00:00Z', reviewed_by: randomUUID() } })
    const result = await api.reviewJoinRequest(orgId, requestId, decision)
    assert.equal(result.id, requestId)
    assert.deepEqual(call, { path: `/organizations/${orgId}/join-requests/${requestId}`, options: { method: 'PATCH', body: { decision } } })
  }
  for (const wrong of [{ ...review(), id: randomUUID(), status: 'approved' }, { ...review(), organization_id: randomUUID(), status: 'approved' }, { ...review(), status: 'rejected' }]) {
    await assert.rejects(apiFor(async () => wrong).reviewJoinRequest(orgId, requestId, 'approve'), /inconsistent review/)
  }
})

test('direct existing-account access validates the returned email, active status, and selected role', async () => {
  let call
  await apiFor(async (path, options) => { call = { path, options }; return member() }).addExistingMember(orgId, { email: 'applicant@example.com', role: 'Member' })
  assert.deepEqual(call, { path: `/organizations/${orgId}/members`, options: { method: 'POST', body: { email: 'applicant@example.com', role: 'Member' } } })
  for (const wrong of [{ ...member(), role: 'Owner' }, { ...member(), status: 'inactive' }, { ...member(), email: 'other@example.com' }]) {
    await assert.rejects(apiFor(async () => wrong).addExistingMember(orgId, { email: 'applicant@example.com', role: 'Member' }), /inconsistent membership/)
  }
})

test('role updates cannot send Owner and reject a mismatched membership or role response', async () => {
  let requested = false
  await assert.rejects(apiFor(async () => { requested = true }).changeMemberRole(orgId, memberId, 'Owner'), /assignable/)
  assert.equal(requested, false)
  for (const wrong of [{ ...member(), id: randomUUID(), role: 'Viewer' }, { ...member(), role: 'Admin' }]) {
    await assert.rejects(apiFor(async () => wrong).changeMemberRole(orgId, memberId, 'Viewer'), /inconsistent membership role/)
  }
})


test('historical Other profiles allow unrelated edits while new Other selections require specification', () => {
  const values = { name: 'Historical group', organization_type: 'Other', organization_type_other: '', country: 'Historical territory', city: '', description: '', is_discoverable: false }
  assert.equal(policies.organizationProfileSchema.safeParse(values).success, false)
  const parsed = policies.organizationProfileSchema.parse({ ...values, legacy_unspecified_type: true })
  assert.equal('organization_type' in policies.profilePayload(parsed), false)
  assert.equal('organization_type_other' in policies.profilePayload(parsed), false)
  assert.equal('legacy_unspecified_type' in policies.profilePayload(parsed), false)
  assert.equal(policies.profilePayload(parsed).country, 'Historical territory')
})
