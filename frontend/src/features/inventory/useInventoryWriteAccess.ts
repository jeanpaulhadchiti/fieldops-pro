import { useOrganization } from '../organizations/useOrganization'

export function useInventoryWriteAccess(organizationId: string) {
  const { organization, membership, error, isLoading } = useOrganization()
  return !isLoading && !error && organization?.id === organizationId && !organization.archived_at && membership?.status === 'active' && ['Owner', 'Admin'].includes(membership.role)
}
