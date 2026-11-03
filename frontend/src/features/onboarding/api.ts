import { z } from 'zod'
import { ApiError, apiRequest } from '../../services/api'
import { countryCode } from '../../data/countries'
import type { User } from '../../types/api'
import { organizationTypes, type DiscoverySearch, type OnboardingOrganization, type OrganizationDraft, type OrganizationMatch, type OwnJoinRequest, type SignupValues } from './types'

const matchSchema = z.object({
  id: z.uuid(), name: z.string(), organization_type: z.enum(organizationTypes),
  organization_type_other: z.string().nullable().optional(),
  country: z.string().nullable(), city: z.string().nullable(), match_kind: z.enum(['exact', 'similar']),
})
const matchesSchema = z.object({ matches: z.array(matchSchema).max(10) })
const organizationSchema = z.object({
  id: z.uuid(), name: z.string(), organization_type: z.enum(organizationTypes),
  organization_type_other: z.string().nullable().optional(),
  country: z.string().nullable(), city: z.string().nullable(), description: z.string().nullable(),
  is_discoverable: z.boolean(), created_at: z.string(),
})
const ownRequestSchema = z.object({
  id: z.uuid(), organization_id: z.uuid(), organization_name: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']), message: z.string().nullable(),
  created_at: z.string(), reviewed_at: z.string().nullable(), membership_active: z.boolean(),
})
const signupResponseSchema = z.object({ id: z.uuid(), name: z.string(), email: z.email(), created_at: z.string() })

export async function signup(values: SignupValues): Promise<User> {
  const result = await apiRequest<unknown>('/auth/register', { method: 'POST', auth: false, body: { name: values.name, email: values.email, password: values.password } })
  const parsed = signupResponseSchema.safeParse(result)
  if (!parsed.success || parsed.data.email.toLowerCase() !== values.email.toLowerCase()) throw new ApiError('The account response could not be verified. Try signing in with your email before submitting another registration.', 502)
  return parsed.data
}

export async function discoverOrganizations(search: DiscoverySearch, signal?: AbortSignal): Promise<OrganizationMatch[]> {
  const params = new URLSearchParams({ q: search.q })
  if (search.organization_type) params.set('organization_type', search.organization_type)
  if (search.country) params.set('country', search.country)
  if (search.city) params.set('city', search.city)
  const result = await apiRequest<unknown>(`/organizations/discover?${params}`, { signal })
  const parsed = matchesSchema.safeParse(result)
  if (!parsed.success) throw new Error('The organization search response could not be verified. Please try again.')
  return uniqueOrganizationMatches(parsed.data.matches)
}

export function uniqueOrganizationMatches(matches: OrganizationMatch[]): OrganizationMatch[] {
  return [...new Map(matches.map(match => [match.id, match])).values()]
}

export async function createOrganization(draft: OrganizationDraft, allowPossibleDuplicate = false): Promise<OnboardingOrganization> {
  const expectedCountry = countryCode(draft.country) ?? draft.country
  const otherType = draft.organization_type === 'Other' ? draft.organization_type_other || null : null
  const result = await apiRequest<unknown>('/organizations', { method: 'POST', body: { ...draft, organization_type_other: otherType, country: expectedCountry, description: draft.description || null, allow_possible_duplicate: allowPossibleDuplicate } })
  const parsed = organizationSchema.safeParse(result)
  if (!parsed.success || parsed.data.name !== draft.name || parsed.data.organization_type !== draft.organization_type
    || (countryCode(parsed.data.country ?? '') ?? parsed.data.country) !== expectedCountry || (parsed.data.organization_type_other ?? null) !== otherType || parsed.data.city !== draft.city || parsed.data.description !== (draft.description || null) || parsed.data.is_discoverable !== draft.is_discoverable) {
    throw new ApiError('The organization response could not be verified. Refresh your organizations before starting another creation attempt.', 502)
  }
  return parsed.data
}

export function possibleDuplicateMatches(error: unknown): OrganizationMatch[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const parsed = matchesSchema.extend({ code: z.literal('possible_duplicate'), message: z.string() }).safeParse(error.detail)
  return parsed.success ? uniqueOrganizationMatches(parsed.data.matches) : null
}

export function isUncertainWrite(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500
}

export async function getOwnJoinRequests(page: number, signal?: AbortSignal): Promise<OwnJoinRequest[]> {
  const result = await apiRequest<unknown>(`/organization-join-requests/mine?page=${page}&page_size=20`, { signal })
  const parsed = z.array(ownRequestSchema).max(20).safeParse(result)
  if (!parsed.success) throw new Error('Your join-request statuses could not be verified. Please refresh them.')
  return parsed.data
}

export async function requestToJoin(organizationId: string, message: string): Promise<OwnJoinRequest> {
  const result = await apiRequest<unknown>(`/organizations/${organizationId}/join-requests`, { method: 'POST', body: { message: message || null } })
  const parsed = ownRequestSchema.safeParse(result)
  if (!parsed.success || parsed.data.organization_id !== organizationId || parsed.data.status !== 'pending' || parsed.data.membership_active) {
    throw new ApiError('The join-request response could not be verified. Refresh your requests before trying again.', 502)
  }
  return parsed.data
}
