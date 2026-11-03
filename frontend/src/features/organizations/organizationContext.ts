import { createContext } from 'react'
import type { Membership, Organization } from '../../types/api'

export interface OrganizationContextValue {
  organizations: Organization[]
  organization: Organization | null
  selectOrganization: (id: string) => void
  refreshOrganizations: (selectId?: string) => Promise<void>
  membership: Membership | null
  canManageEvents: boolean
  isLoading: boolean
  error: unknown
  retry: () => void
}

export const OrganizationContext = createContext<OrganizationContextValue | null>(null)
