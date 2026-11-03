import countryNames from './countries.json'

// ISO 3166-1 alpha-2 assignments, with English names generated from the
// maintained Unicode CLDR data bundled in Node/ICU. No network request at runtime.
export const countries = Object.entries(countryNames).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').trim()
const aliases: Record<string, string> = {
  'united states of america': 'US', usa: 'US', uk: 'GB', 'great britain': 'GB', turkey: 'TR', 'czech republic': 'CZ', 'russian federation': 'RU',
  'korea, republic of': 'KR', 'republic of korea': 'KR', 'viet nam': 'VN', 'iran, islamic republic of': 'IR', 'syrian arab republic': 'SY',
  'holy see': 'VA', vatican: 'VA', palestine: 'PS',
}
export function countryCode(value: string): string | undefined {
  const key = fold(value)
  return aliases[key] ?? countries.find(country => fold(country.code) === key || fold(country.name) === key)?.code
}
export function countryName(value: string | null | undefined): string {
  if (!value) return ''
  const code = countryCode(value)
  return countries.find(country => country.code === code)?.name ?? value
}
export function searchCountries(query: string) {
  const key = fold(query)
  return countries.filter(country => fold(country.name).includes(key) || fold(country.code).includes(key))
}
