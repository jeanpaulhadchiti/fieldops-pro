import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const module = { exports: {} }
const input = readFileSync(new URL('../src/features/inventory/formSchemas.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
new Function('require', 'module', 'exports', outputText)(require, module, module.exports)
const { equipmentFormSchema, taxonomyFormSchema } = module.exports
const equipment = () => ({ name: 'Tent', sku: '', unit: 'piece', item_type: 'reusable', minimum_quantity: '0', category_id: '', location_id: '' })

test('equipment form trims text and allows explicitly unassigned category/location', () => {
  const values = equipmentFormSchema.parse({ ...equipment(), name: '  Tent  ', sku: '  CAMP-1 ', unit: ' piece ', minimum_quantity: ' 0.25 ' })
  assert.equal(values.name, 'Tent')
  assert.equal(values.sku, 'CAMP-1')
  assert.equal(values.unit, 'piece')
  assert.equal(values.minimum_quantity, '0.25')
  assert.equal(values.category_id, '')
  assert.equal(values.location_id, '')
})

test('minimum stock rejects negative, non-finite, scientific, oversized and overprecision values', () => {
  for (const minimum_quantity of ['', ' ', '-1', '-0', 'NaN', 'Infinity', '-Infinity', '1e2', '0.001', '1.234', '10000000000', '10000000000.00', '0x10', '1,2', '1.']) {
    assert.equal(equipmentFormSchema.safeParse({ ...equipment(), minimum_quantity }).success, false, minimum_quantity)
  }
  for (const minimum_quantity of ['0', '0.01', '1.2', '1.20', '9999999999.99']) {
    assert.equal(equipmentFormSchema.safeParse({ ...equipment(), minimum_quantity }).success, true, minimum_quantity)
  }
})

test('equipment validation bounds all details and rejects invalid associations and NUL text', () => {
  const id = '00b04a92-e11c-4cb3-95e9-2db89c70e00c'
  assert.equal(equipmentFormSchema.safeParse({ ...equipment(), category_id: id, location_id: id }).success, true)
  for (const override of [{ name: ' ' }, { name: 'x'.repeat(151) }, { sku: 'x'.repeat(51) }, { unit: ' ' }, { unit: 'x'.repeat(21) }, { item_type: 'unknown' }, { category_id: 'other-org' }, { location_id: 'other-org' }, { name: 'bad\0name' }, { sku: '\0' }, { unit: '\0' }]) {
    assert.equal(equipmentFormSchema.safeParse({ ...equipment(), ...override }).success, false, JSON.stringify(override))
  }
})

test('category and location form share trimmed required names and bounded descriptions', () => {
  assert.deepEqual(taxonomyFormSchema.parse({ name: '  Camping  ', description: '  Outdoor supplies  ' }), { name: 'Camping', description: 'Outdoor supplies' })
  assert.deepEqual(taxonomyFormSchema.parse({ name: 'Depot', description: '  ' }), { name: 'Depot', description: '' })
  assert.equal(taxonomyFormSchema.safeParse({ name: 'x'.repeat(100), description: 'x'.repeat(500) }).success, true)
  for (const values of [{ name: ' ', description: '' }, { name: 'x'.repeat(101), description: '' }, { name: 'Depot', description: 'x'.repeat(501) }, { name: 'bad\0name', description: '' }, { name: 'Depot', description: '\0' }]) {
    assert.equal(taxonomyFormSchema.safeParse(values).success, false)
  }
})
