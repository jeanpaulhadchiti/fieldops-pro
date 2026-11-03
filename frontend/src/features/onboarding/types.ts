export const organizationTypes = ['Scout Group', 'Sports Club', 'NGO', 'Other'] as const
export type OrganizationType = typeof organizationTypes[number]

export interface OrganizationMatch {
  id: string
  name: string
  organization_type: OrganizationType
  organization_type_other?: string | null
  country: string | null
  city: string | null
  match_kind: 'exact' | 'similar'
}

export interface DiscoverySearch {
  q: string
  organization_type?: OrganizationType
  country?: string
  city?: string
}

export interface OrganizationDraft {
  name: string
  organization_type: OrganizationType
  organization_type_other?: string
  country: string
  city: string
  description: string
  is_discoverable: boolean
}

export interface OnboardingOrganization {
  id: string
  name: string
  organization_type: OrganizationType
  organization_type_other?: string | null
  country: string | null
  city: string | null
  description: string | null
  is_discoverable: boolean
  created_at: string
}

export interface OwnJoinRequest {
  id: string
  organization_id: string
  organization_name: string
  status: 'pending' | 'approved' | 'rejected'
  message: string | null
  created_at: string
  reviewed_at: string | null
  membership_active: boolean
}

export interface SignupValues {
  name: string
  email: string
  password: string
  confirmPassword: string
}
