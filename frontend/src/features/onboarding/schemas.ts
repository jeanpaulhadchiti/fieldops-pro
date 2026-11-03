import { z } from 'zod'
import { organizationTypes } from './types'
import { countryCode } from '../../data/countries'

export const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()
const requiredText = (label: string, maximum: number) => z.string().transform(normalizeWhitespace).pipe(z.string().min(1, `Enter ${label}.`).max(maximum, `Use ${maximum} characters or fewer.`))

export const signupSchema = z.object({
  name: requiredText('your full name', 120),
  email: z.string().trim().pipe(z.email('Enter a valid email address.')),
  password: z.string().refine(value => Array.from(value).length >= 10, 'Use at least 10 characters.').refine(value => Array.from(value).length <= 128, 'Use 128 characters or fewer.').refine(value => Boolean(value.trim()), 'Password cannot contain only whitespace.').refine(value => /[A-Z]/.test(value), 'Include at least one uppercase letter (A–Z).').refine(value => /[\p{P}\p{S}]/u.test(value), 'Include at least one special character, such as !, @, or #.'),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
}).refine(values => values.password === values.confirmPassword, { path: ['confirmPassword'], message: 'Passwords must match.' })

export const organizationDraftSchema = z.object({
  name: requiredText('an organization name', 150),
  organization_type: z.enum(organizationTypes),
  organization_type_other: z.string().refine(value => !value.includes('\0'), 'Null characters are not allowed.').transform(normalizeWhitespace).pipe(z.string().max(100, 'Use 100 characters or fewer.')).optional(),
  country: requiredText('a country', 100).transform(value => countryCode(value) ?? value).refine(value => Boolean(countryCode(value)), 'Choose a country from the list.'),
  city: requiredText('a city or area', 100),
  description: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
  is_discoverable: z.boolean(),
}).superRefine((values, context) => {
  if (values.organization_type === 'Other' && !values.organization_type_other) context.addIssue({ code: 'custom', path: ['organization_type_other'], message: 'Specify the organization type.' })
}).transform(values => ({ ...values, organization_type_other: values.organization_type === 'Other' ? values.organization_type_other : '' }))

export const discoveryFormSchema = z.object({
  q: z.string().transform(normalizeWhitespace).pipe(z.string().min(3, 'Enter at least 3 characters to search.').max(150, 'Use 150 characters or fewer.')),
  organization_type: z.union([z.literal(''), z.enum(organizationTypes)]),
  country: z.string().trim().max(100, 'Use 100 characters or fewer.'),
  city: z.string().trim().max(100, 'Use 100 characters or fewer.'),
})

export const joinMessageSchema = z.object({ message: z.string().trim().max(1000, 'Use 1,000 characters or fewer.') })
