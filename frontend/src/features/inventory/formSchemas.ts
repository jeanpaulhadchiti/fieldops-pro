import { z } from 'zod'

const text = (maximum: number) => z.string().trim().max(maximum, `Maximum ${maximum} characters`).refine(value => !value.includes('\0'), 'NUL characters are not allowed')
const association = z.union([z.literal(''), z.uuid()])

export const equipmentFormSchema = z.object({
  name: text(150).refine(value => value.length > 0, 'Equipment name is required'),
  sku: text(50),
  unit: text(20).refine(value => value.length > 0, 'Unit is required'),
  item_type: z.enum(['reusable', 'consumable']),
  minimum_quantity: z.string().trim().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a non-negative quantity with up to 2 decimal places (maximum 9999999999.99)'),
  category_id: association,
  location_id: association,
})

export const taxonomyFormSchema = z.object({
  name: text(100).refine(value => value.length > 0, 'Name is required'),
  description: text(500),
})

export type EquipmentFormValues = z.infer<typeof equipmentFormSchema>
export type TaxonomyFormValues = z.infer<typeof taxonomyFormSchema>
