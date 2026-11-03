import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function api(responder) {
  const input = readFileSync(new URL('../src/features/notifications/api.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => name === '../../services/api' ? { apiRequest: responder } : require(name), module, module.exports)
  return module.exports
}
const item = () => ({ id: randomUUID(), organization_id: randomUUID(), organization_name: 'Field team', join_request_id: randomUUID(), applicant_name: 'Applicant', status: 'pending', created_at: '2027-01-01T10:00:00Z', updated_at: '2027-01-01T10:00:00Z', read_at: null })

test('notification feed uses recipient-owned API with bounded pagination and cancellation', async () => {
  const signal = new AbortController().signal
  let call
  const expected = { items: [item()], unread_count: 4, has_more: true }
  assert.deepEqual(await api(async (path, options) => { call = { path, options }; return expected }).getNotifications(2, signal), expected)
  assert.deepEqual(call, { path: '/notifications?page=2&page_size=20', options: { signal } })
})

test('notification adapter rejects malformed counts, statuses, and identifiers', async () => {
  for (const response of [{ items: [item()], unread_count: -1, has_more: false }, { items: [{ ...item(), status: 'forged' }], unread_count: 1, has_more: false }, { items: [{ ...item(), organization_id: 'wrong' }], unread_count: 1, has_more: false }]) {
    await assert.rejects(api(async () => response).getNotifications(1), /inconsistent notification/)
  }
})

test('read updates send only status and reject changed notification or organization scope', async () => {
  const original = item()
  let call
  await api(async (path, options) => { call = { path, options }; return { ...original, read_at: '2027-01-01T11:00:00Z' } }).setNotificationRead(original, true)
  assert.deepEqual(call, { path: `/notifications/${original.id}`, options: { method: 'PATCH', body: { is_read: true } } })
  for (const response of [{ ...original, id: randomUUID() }, { ...original, organization_id: randomUUID() }, { ...original, join_request_id: randomUUID() }, { ...original, read_at: '2027-01-01T11:00:00Z' }]) {
    await assert.rejects(api(async () => response).setNotificationRead(original, false), /inconsistent notification/)
  }
})

test('notification navigation identifies the request and cache keys isolate account and session', () => {
  const original = item()
  const { notificationTarget, notificationKeys } = api(async () => {})
  assert.equal(notificationTarget(original), `/settings/members?organization=${original.organization_id}&section=requests&request=${original.join_request_id}&status=pending`)
  const key = notificationKeys.page('person', 1, 1)
  for (const different of [notificationKeys.page('other', 1, 1), notificationKeys.page('person', 2, 1), notificationKeys.page('person', 1, 2)]) assert.notDeepEqual(key, different)
})
