import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '../../services/api'
import { queryClient } from '../../services/queryClient'
import { getSession } from '../../services/session'
import type { Membership, Organization } from '../../types/api'
import { useAuth } from '../auth/useAuth'
import { OrganizationContext } from './organizationContext'

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const storageKey = `fieldops.organization.${user!.id}`
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(storageKey) } catch { return null }
  })
  const selectionGeneration = useRef(0)
  const organizationsQuery = useQuery({
    queryKey: ['organizations', user!.id],
    queryFn: ({ signal }) => apiRequest<Organization[]>('/organizations', { signal }),
  })
  const organizations = organizationsQuery.data ?? []
  // Persisted choices are preferences only; membership is always checked against the API.
  const organization = organizations.find(org => org.id === selectedId) ?? organizations.find(org => !org.archived_at) ?? organizations[0] ?? null
  const membershipQuery = useQuery({
    queryKey: ['organization-members', user!.id, organization?.id],
    queryFn: ({ signal }) => apiRequest<Membership[]>(`/organizations/${organization!.id}/members`, { signal }),
    enabled: Boolean(organization),
  })
  const membership = membershipQuery.data?.find(member => member.user_id === user!.id && member.status === 'active') ?? null
  const error = organizationsQuery.error ?? (organization ? membershipQuery.error : null)
    ?? (organization && membershipQuery.isSuccess && !membership ? new Error('Your active membership could not be verified. Refresh your organizations or contact an administrator.') : null)

  function selectOrganization(id: string) {
    const currentOrganizations = queryClient.getQueryData<Organization[]>(['organizations', user!.id]) ?? organizations
    if (!currentOrganizations.some(org => org.id === id)) return
    // Queries use organization-specific keys, and old requests are aborted on a switch.
    const scopedQueries = new Set(['inventory', 'events', 'organization-members', 'participants', 'registrations', 'tasks', 'task-assignments', 'organization-settings', 'organization-join-requests'])
    void queryClient.cancelQueries({ predicate: query => scopedQueries.has(String(query.queryKey[0])) })
    setSelectedId(id)
    selectionGeneration.current += 1
    try { sessionStorage.setItem(storageKey, id) } catch { /* In-memory selection still works. */ }
  }

  async function refreshOrganizations(selectId?: string) {
    const sessionVersion = getSession().version
    const priorSelection = selectionGeneration.current
    const refreshed = await organizationsQuery.refetch()
    if (getSession().version !== sessionVersion) throw new Error('Your session changed while refreshing organizations. Please continue in your current session.')
    if (refreshed.error) throw refreshed.error
    if (selectId) {
      if (selectionGeneration.current !== priorSelection) throw new Error('Your selected organization changed. Choose the organization you want to open again.')
      if (!refreshed.data?.some(org => org.id === selectId)) throw new Error('An active membership for this organization could not be verified. Refresh your requests or contact an administrator.')
      selectOrganization(selectId)
    }
  }

  return (
    <OrganizationContext.Provider value={{
      organizations,
      organization,
      selectOrganization,
      refreshOrganizations,
      membership,
      canManageEvents: !error && !organization?.archived_at && Boolean(membership && ['Owner', 'Admin'].includes(membership.role)),
      isLoading: organizationsQuery.isPending || Boolean(organization && membershipQuery.isPending),
      error,
      retry: () => { void organizationsQuery.refetch(); if (organization) void membershipQuery.refetch() },
    }}>
      {children}
    </OrganizationContext.Provider>
  )
}
