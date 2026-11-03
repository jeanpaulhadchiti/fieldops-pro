import { z } from 'zod'
import { apiRequest } from '../../../services/api'
import { assignableRoles, organizationTypes } from './types'
import type { AssignableRole, JoinRequestReview, MemberAdd, Membership, OrganizationProfile, ReviewDecision } from './types'
import type { OrganizationProfileValues } from './policies'
import { profilePayload } from './policies'

const profile = z.object({
  id: z.uuid(), name: z.string(), organization_type: z.enum(organizationTypes),
  organization_type_other: z.string().nullable().optional(), archived_at: z.string().nullable().optional(), archived_by: z.uuid().nullable().optional(),
  country: z.string().nullable(), city: z.string().nullable(), description: z.string().nullable(),
  is_discoverable: z.boolean(), created_at: z.string(),
})
const request = z.object({
  id: z.uuid(), organization_id: z.uuid(), organization_name: z.string(), user_id: z.uuid(),
  applicant_name: z.string(), applicant_email: z.email(), status: z.enum(['pending', 'approved', 'rejected']),
  message: z.string().nullable(), created_at: z.string(), reviewed_at: z.string().nullable(),
  reviewed_by: z.uuid().nullable(), membership_active: z.boolean(),
})
const member = z.object({
  id: z.uuid(), user_id: z.uuid(), name: z.string(), email: z.email(), role: z.string(), status: z.string(), created_at: z.string(),
})

function checked<T>(schema: z.ZodType<T>, response: unknown): T {
  const result = schema.safeParse(response)
  if (!result.success) throw new Error('The API returned inconsistent organization administration data. Refresh and try again.')
  return result.data
}

function checkedProfile(organizationId: string, response: unknown) {
  const result = checked(profile, response)
  if (result.id !== organizationId) throw new Error('The API returned a different organization. Refresh your workspace.')
  return result
}

export async function getOrganizationProfile(organizationId: string, signal?: AbortSignal): Promise<OrganizationProfile> {
  return checkedProfile(organizationId, await apiRequest<unknown>(`/organizations/${organizationId}`, { signal }))
}

export async function saveOrganizationProfile(organizationId: string, values: OrganizationProfileValues): Promise<OrganizationProfile> {
  return checkedProfile(organizationId, await apiRequest<unknown>(`/organizations/${organizationId}/settings`, { method: 'PATCH', body: profilePayload(values) }))
}

export async function getJoinRequests(organizationId: string, status: string, page: number, signal?: AbortSignal, requestId?: string): Promise<JoinRequestReview[]> {
  const query = new URLSearchParams({ page: String(page), page_size: '25' })
  if (status) query.set('status', status)
  if (requestId) query.set('request_id', requestId)
  const result = checked(z.array(request), await apiRequest<unknown>(`/organizations/${organizationId}/join-requests?${query}`, { signal }))
  if (result.some(item => item.organization_id !== organizationId)) throw new Error('Join requests do not match the selected organization. Refresh your workspace.')
  if (requestId && result.some(item => item.id !== requestId)) throw new Error('Join requests do not match the notification. Refresh your workspace.')
  return result
}

export async function reviewJoinRequest(organizationId: string, requestId: string, decision: ReviewDecision): Promise<JoinRequestReview> {
  const result = checked(request, await apiRequest<unknown>(`/organizations/${organizationId}/join-requests/${requestId}`, { method: 'PATCH', body: { decision } }))
  if (result.organization_id !== organizationId || result.id !== requestId || result.status !== (decision === 'approve' ? 'approved' : 'rejected')) {
    throw new Error('The API returned an inconsistent review result. Refresh the requests before retrying.')
  }
  return result
}

export async function getOrganizationMembers(organizationId: string, signal?: AbortSignal): Promise<Membership[]> {
  return checked(z.array(member), await apiRequest<unknown>(`/organizations/${organizationId}/members`, { signal }))
}

export async function addExistingMember(organizationId: string, values: MemberAdd): Promise<Membership> {
  const result = checked(member, await apiRequest<unknown>(`/organizations/${organizationId}/members`, { method: 'POST', body: { email: values.email, role: values.role } }))
  if (result.role !== values.role || result.status !== 'active' || result.email.toLowerCase() !== values.email.toLowerCase()) {
    throw new Error('The API returned an inconsistent membership. Refresh the member list before retrying.')
  }
  return result
}

export async function changeMemberRole(organizationId: string, membershipId: string, role: AssignableRole): Promise<Membership> {
  if (!assignableRoles.includes(role)) throw new Error('Select an assignable membership role.')
  const result = checked(member, await apiRequest<unknown>(`/organizations/${organizationId}/members/${membershipId}/role`, { method: 'PATCH', body: { role } }))
  if (result.id !== membershipId || result.role !== role) throw new Error('The API returned an inconsistent membership role. Refresh before retrying.')
  return result
}
