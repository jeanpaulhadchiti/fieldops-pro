import { z } from 'zod'
import { formatQuantity, maxQuantityCents, quantityCents } from './quantity'

export const movementSchema = z.object({
  movement_type: z.enum(['opening', 'receive', 'issue', 'return', 'adjustment']),
  quantity: z.string().trim().refine(value => Number.isFinite(quantityCents(value)) && quantityCents(value) !== 0,
    'Enter a nonzero quantity with up to 2 decimal places (maximum 9999999999.99).'),
  notes: z.string().trim().max(1000, 'Maximum 1000 characters').refine(value => !value.includes('\0'), 'NUL characters are not allowed'),
}).superRefine((values, context) => {
  if (values.movement_type !== 'adjustment' && quantityCents(values.quantity) <= 0) {
    context.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a positive quantity. Issue subtracts it from stock.' })
  }
  if (values.movement_type === 'adjustment' && !values.notes) {
    context.addIssue({ code: 'custom', path: ['notes'], message: 'An adjustment reason is required.' })
  }
})

export type MovementValues = z.infer<typeof movementSchema>

export function movementDelta(values: MovementValues): string {
  const cents = quantityCents(values.quantity)
  return formatQuantity(values.movement_type === 'issue' ? -cents : cents)
}

export function stockConflict(values: MovementValues, currentQuantity: string, hasMovements: boolean): string | null {
  if (values.movement_type === 'opening' && (hasMovements || quantityCents(currentQuantity) !== 0)) {
    return 'Opening stock is only allowed before the first movement and with zero stock.'
  }
  const after = quantityCents(currentQuantity) + quantityCents(movementDelta(values))
  if (after < 0) return 'Insufficient inventory stock. Enter a smaller quantity.'
  if (after > maxQuantityCents) return 'Quantity exceeds storage limits.'
  return null
}
