import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function source(path, dependencies = {}) {
  const input = readFileSync(new URL(`../src/features/inventory/${path}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('.')) throw new Error(`Unexpected dependency ${name}`)
    return require(name)
  }, module, module.exports)
  return module.exports
}
const quantities = source('quantity')
const movements = source('movementSchema', { './quantity': quantities })
const valid = overrides => ({ movement_type: 'receive', quantity: '0.10', notes: '', ...overrides })

function transport(handler) {
  const calls = []
  let version = 1
  const session = { getSession: () => ({ version, token: 'test-session' }) }
  const api = source('api', {
    '../../services/session': session,
    '../../services/api': { apiRequest: async (path, options = {}) => { calls.push({ path, options }); return handler(path, options, calls.length) } },
  })
  return { api, calls, switchSession: () => { version++ } }
}

test('quantities calculate exactly through the complete Numeric(12,2) range', () => {
  const { quantityCents, formatQuantity, maxQuantityCents } = quantities
  assert.equal(quantityCents('0.10') + quantityCents('0.20'), quantityCents('0.30'))
  assert.equal(formatQuantity(quantityCents('9999999999.99')), '9999999999.99')
  assert.equal(quantityCents('9999999999.99'), maxQuantityCents)
  assert.equal(formatQuantity(quantityCents('-0.01')), '-0.01')
  for (const value of ['NaN', 'Infinity', '1e2', '0.001', '10000000000', '', ' 1', '1.', '+1', '0x10']) assert.ok(Number.isNaN(quantityCents(value)), value)
})

test('movement validation enforces signed rules, two decimals, nonzero and adjustment reasons', () => {
  for (const quantity of ['', '0', '-0.00', '0.001', 'NaN', 'Infinity', '1e10', '10000000000']) assert.equal(movements.movementSchema.safeParse(valid({ quantity })).success, false, quantity)
  for (const movement_type of ['opening', 'receive', 'issue', 'return']) {
    assert.equal(movements.movementSchema.safeParse(valid({ movement_type, quantity: '-1' })).success, false)
    assert.equal(movements.movementSchema.safeParse(valid({ movement_type, quantity: '1.25' })).success, true)
  }
  assert.equal(movements.movementSchema.safeParse(valid({ movement_type: 'adjustment', quantity: '-1', notes: '  ' })).success, false)
  assert.equal(movements.movementSchema.safeParse(valid({ notes: 'bad\0note' })).success, false)
  assert.equal(movements.movementSchema.safeParse(valid({ notes: 'x'.repeat(1001) })).success, false)
  assert.equal(movements.movementDelta(valid({ movement_type: 'issue', quantity: '0.30' })), '-0.30')
  assert.equal(movements.movementDelta(valid({ movement_type: 'adjustment', quantity: '-0.30', notes: 'Count' })), '-0.30')
})

test('opening, insufficiency, exact-zero and overflow checks agree with backend rules', () => {
  assert.match(movements.stockConflict(valid({ movement_type: 'opening' }), '0.00', true), /first movement/)
  assert.match(movements.stockConflict(valid({ movement_type: 'opening' }), '1.00', false), /zero stock/)
  assert.equal(movements.stockConflict(valid({ movement_type: 'issue', quantity: '0.30' }), '0.30', true), null)
  assert.match(movements.stockConflict(valid({ movement_type: 'issue', quantity: '0.31' }), '0.30', true), /Insufficient/)
  assert.match(movements.stockConflict(valid({ quantity: '0.01' }), '9999999999.99', true), /limits/)
})

test('item discovery and movement history fetch every page and preserve scoping and order', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(index), organization_id: 'org-a', item_id: 'item-a' }))
  const harness = transport(path => { const url = new URL(path, 'http://unit'); return rows.slice(Number(url.searchParams.get('offset')), Number(url.searchParams.get('offset')) + Number(url.searchParams.get('limit'))) })
  assert.equal((await harness.api.getInventoryItems('org-a', undefined, true)).length, 1001)
  assert.equal(harness.calls.length, 3)
  assert.deepEqual(harness.calls.map(call => new URL(call.path, 'http://unit').searchParams.get('offset')), ['0', '500', '1000'])
  for (const call of harness.calls) { assert.match(call.path, /organization_id=org-a/); assert.match(call.path, /archived=true/); assert.match(call.path, /limit=500/) }
  const history = await harness.api.getInventoryMovements('org-a', 'item-a')
  assert.deepEqual(history, rows)
  assert.match(harness.calls.at(-1).path, /item_id=item-a/)
})

test('partial pagination is discarded when any page fails or the account changes', async () => {
  const full = Array.from({ length: 500 }, (_, index) => ({ id: String(index), organization_id: 'org' }))
  const failing = transport((_path, _options, count) => { if (count === 2) throw new Error('page failed'); return full })
  await assert.rejects(failing.api.getInventoryItems('org'), /page failed/)
  const switching = transport(() => { switching.switchSession(); return full })
  await assert.rejects(switching.api.getInventoryItems('org'), /session changed/)
  assert.equal(switching.calls.length, 1)
})

test('aborted organization reads cannot issue another page or render their partial data', async () => {
  const controller = new AbortController()
  const harness = transport((_path, options) => { assert.equal(options.signal, controller.signal); controller.abort(); return Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) })
  await assert.rejects(harness.api.getInventoryItems('org', controller.signal), { name: 'AbortError' })
  assert.equal(harness.calls.length, 1)
})

test('reads reject an unexpected tenant or item instead of rendering records in the selected workspace', async () => {
  const foreign = transport(() => [{ id: 'foreign', organization_id: 'other', item_id: 'wrong-item' }])
  await assert.rejects(foreign.api.getInventoryItems('org'), /workspace/)
  await assert.rejects(foreign.api.getInventoryCategories('org'), /workspace/)
  await assert.rejects(foreign.api.getStorageLocations('org'), /workspace/)
  const wrongItem = transport(() => [{ id: 'foreign', organization_id: 'org', item_id: 'wrong-item' }])
  await assert.rejects(wrongItem.api.getInventoryMovements('org', 'expected-item'), /equipment/)
})

test('writes use scoped endpoints, nullable assignments and movement bodies, never a stock patch', async () => {
  const harness = transport(() => ({}))
  await harness.api.updateInventoryItem('item/id', 'org a', { category_id: null, location_id: null })
  await harness.api.archiveInventoryItem('item/id', 'org a')
  await harness.api.restoreInventoryItem('item/id', 'org a')
  await harness.api.updateInventoryCategory('cat', 'org a', { name: 'Camping', description: null })
  await harness.api.deleteInventoryCategory('cat', 'org a')
  await harness.api.updateStorageLocation('loc', 'org a', { name: 'Depot', description: null })
  await harness.api.deleteStorageLocation('loc', 'org a')
  const movement = { organization_id: 'org a', item_id: 'item/id', movement_type: 'issue', quantity_delta: '-0.30', notes: null }
  await harness.api.createInventoryMovement(movement)
  assert.match(harness.calls[0].path, /items\/item%2Fid\?organization_id=org\+a$/)
  assert.deepEqual(harness.calls[0].options.body, { category_id: null, location_id: null })
  assert.deepEqual(harness.calls.map(call => call.options.method), ['PATCH', 'DELETE', 'POST', 'PATCH', 'DELETE', 'PATCH', 'DELETE', 'POST'])
  assert.match(harness.calls[2].path, /\/restore\?organization_id=org\+a$/)
  assert.deepEqual(harness.calls.at(-1).options.body, movement)
})

test('query keys include account generation, organization, archive view and item history', () => {
  const queries = source('queries', {
    react: { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() },
    '@tanstack/react-query': { useQuery: options => options },
    '../../services/session': { subscribeSession() {}, getSession: () => ({ version: 9, token: 'test' }) },
    './api': {},
  })
  assert.deepEqual(queries.useInventoryItems('a', true).queryKey, ['inventory', 'items', 'a', 9, true])
  assert.notDeepEqual(queries.useInventoryItems('a').queryKey, queries.useInventoryItems('b').queryKey)
  assert.deepEqual(queries.useInventoryMovements('a', 'item').queryKey, ['inventory', 'movements', 'a', 9, 'item'])
  assert.equal(queries.useInventoryItems(undefined).enabled, false)
  assert.equal(queries.useInventoryMovements('a', undefined).enabled, false)
})

test('inventory mutations reject wrong workspace, inactive or read-only membership and archived orgs', async () => {
  let scope
  const invalidations = []
  let writes = 0
  const { useInventoryMutation } = source('useInventoryMutation', {
    '@tanstack/react-query': { useQueryClient: () => ({ cancelQueries: async () => {}, invalidateQueries: async options => invalidations.push(options) }) },
    '../../hooks/useScopedMutation': { useScopedMutation: options => options },
    '../../services/session': { getSession: () => ({ version: 1 }) },
    '../organizations/useOrganization': { useOrganization: () => scope },
  })
  const active = { organization: { id: 'a', archived_at: null }, membership: { role: 'Owner', status: 'active' } }
  for (const change of [{ isLoading: true }, { organization: { id: 'b' } }, { organization: { id: 'a', archived_at: 'today' } }, { membership: { role: 'owner', status: 'active' } }, { membership: { role: 'Member', status: 'active' } }, { membership: { role: 'Admin', status: 'inactive' } }, { error: new Error('membership failed') }]) {
    scope = { ...active, ...change }
    await assert.rejects(useInventoryMutation({ organizationId: 'a', mutationFn: async () => { writes++; return {} } }).mutationFn({}), /active Owner or Admin/)
  }
  assert.equal(writes, 0)
  scope = active
  await useInventoryMutation({ organizationId: 'a', mutationFn: async () => { writes++; return {} } }).mutationFn({})
  assert.equal(writes, 1)
  const predicate = invalidations[0].predicate
  assert.equal(predicate({ queryKey: ['inventory', 'items', 'a', 1, false] }), true)
  assert.equal(predicate({ queryKey: ['inventory', 'items', 'b', 1, false] }), false)
})

test('saving during an initial read aborts stale pages and actually refreshes the active query', async () => {
  const { QueryClient, QueryObserver } = require('@tanstack/react-query')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const key = ['inventory', 'items', 'a', 1, false]
  let reads = 0
  let initialSignal
  const observer = new QueryObserver(client, { queryKey: key, queryFn: ({ signal }) => {
    reads++
    if (reads === 1) {
      initialSignal = signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled old pages', 'AbortError')), { once: true }))
    }
    return [{ id: 'new-item', organization_id: 'a' }]
  } })
  const unsubscribe = observer.subscribe(() => {})
  const { useInventoryMutation } = source('useInventoryMutation', {
    '@tanstack/react-query': { useQueryClient: () => client },
    '../../hooks/useScopedMutation': { useScopedMutation: options => options },
    '../../services/session': { getSession: () => ({ version: 1 }) },
    '../organizations/useOrganization': { useOrganization: () => ({ organization: { id: 'a' }, membership: { role: 'Admin', status: 'active' } }) },
  })
  try {
    assert.equal(reads, 1)
    assert.equal(client.getQueryData(key), undefined)
    await useInventoryMutation({ organizationId: 'a', mutationFn: async () => ({ id: 'new-item' }) }).mutationFn({})
    assert.equal(initialSignal.aborted, true)
    assert.equal(reads, 2)
    assert.deepEqual(client.getQueryData(key), [{ id: 'new-item', organization_id: 'a' }])
  } finally { unsubscribe(); client.clear() }
})

test('a replacement session during read cancellation prevents the old mutation from refreshing its cache', async () => {
  let version = 1
  let refetches = 0
  const { useInventoryMutation } = source('useInventoryMutation', {
    '@tanstack/react-query': { useQueryClient: () => ({
      cancelQueries: async () => { version++ },
      invalidateQueries: async () => { refetches++ },
    }) },
    '../../hooks/useScopedMutation': { useScopedMutation: options => options },
    '../../services/session': { getSession: () => ({ version }) },
    '../organizations/useOrganization': { useOrganization: () => ({ organization: { id: 'a' }, membership: { role: 'Admin', status: 'active' } }) },
  })
  await useInventoryMutation({ organizationId: 'a', mutationFn: async () => ({}) }).mutationFn({})
  assert.equal(refetches, 0)
})
