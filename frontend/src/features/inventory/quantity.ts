export const maxQuantityCents = 999999999999

/** Numeric(12,2) fits safely in integer cents; never calculate stock with floats. */
export function quantityCents(value: string): number {
  if (!/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) return NaN
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return negative ? -cents : cents
}

export function formatQuantity(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Invalid quantity')
  const absolute = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
