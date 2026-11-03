import type { Membership } from '../../../types/api'

export const organizationTypes = ['Scout Group', 'Sports Club', 'NGO', 'Other'] as const
export type OrganizationType = typeof organizationTypes[number]
export const assignableRoles = ['Admin', 'Treasurer', 'Logistics', 'Member', 'Viewer'] as const
export type AssignableRole = typeof assignableRoles[number]
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected'
export type ReviewDecision = 'approve' | 'reject'

export interface OrganizationProfile {
  id: string
  name: string
  organization_type: OrganizationType
  organization_type_other?: string | null
  archived_at?: string | null
  archived_by?: string | null
  country: string | null
  city: string | null
  description: string | null
  is_discoverable: boolean
  created_at: string
}

export interface JoinRequestReview {
  id: string
  organization_id: string
  organization_name: string
  user_id: string
  applicant_name: string
  applicant_email: string
  status: JoinRequestStatus
  message: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  membership_active: boolean
}

export interface MemberAdd {
  email: string
  role: AssignableRole
}

export type { Membership }
