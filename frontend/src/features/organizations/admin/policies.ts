import { z } from 'zod'
import { assignableRoles, organizationTypes } from './types'
import type { AssignableRole, Membership } from './types'

const normalizedText = (maximum: number) => z.string().transform(value => value.replace(/\s+/g, ' ').trim()).pipe(z.string().max(maximum, `Use ${maximum} characters or fewer.`))

export const organizationProfileSchema = z.object({
  name: normalizedText(150).pipe(z.string().min(1, 'Enter the organization name.')),
  organization_type: z.enum(organizationTypes),
  organization_type_other: z.string().refine(value => !value.includes('\0'), 'Null characters are not allowed.').pipe(normalizedText(100)).optional(),
  legacy_unspecified_type: z.boolean().optional(),
  country: normalizedText(100),
  city: normalizedText(100),
  description: z.string().trim().max(2000, 'Use 2,000 characters or fewer.'),
  is_discoverable: z.boolean(),
}).superRefine((values, context) => {
  if (values.organization_type === 'Other' && !values.organization_type_other && !values.legacy_unspecified_type) context.addIssue({ code: 'custom', path: ['organization_type_other'], message: 'Specify the organization type.' })
})

export type OrganizationProfileInput = z.input<typeof organizationProfileSchema>
export type OrganizationProfileValues = z.output<typeof organizationProfileSchema>

export const memberAddSchema = z.object({
  email: z.string().trim().pipe(z.email('Enter a valid registered email address.')),
  role: z.enum(assignableRoles),
})

export function rolesAllowedFor(reviewerRole: string): AssignableRole[] {
  if (reviewerRole === 'Owner') return [...assignableRoles]
  if (reviewerRole === 'Admin') return assignableRoles.filter(role => role !== 'Admin')
  return []
}

export function canChangeMemberRole(reviewerRole: string, reviewerUserId: string, target: Membership): boolean {
  return target.status === 'active'
    && target.user_id !== reviewerUserId
    && target.role !== 'Owner'
    && (reviewerRole === 'Owner' || (reviewerRole === 'Admin' && target.role !== 'Admin'))
}

export const administrationKeys = {
  profile: (userId: string, organizationId: string) => ['organization-settings', userId, organizationId] as const,
  requests: (userId: string, organizationId: string, status: string, page: number) => ['organization-join-requests', userId, organizationId, status, page] as const,
  members: (userId: string, organizationId: string) => ['organization-members', userId, organizationId] as const,
}

export function profilePayload(values: OrganizationProfileValues) {
  const { legacy_unspecified_type, organization_type, organization_type_other, ...fields } = values
  const metadata = { ...fields, country: values.country || null, city: values.city || null, description: values.description || null }
  if (legacy_unspecified_type && organization_type === 'Other' && !organization_type_other) return metadata
  return { ...metadata, organization_type, organization_type_other: organization_type === 'Other' ? organization_type_other || null : null }
}
