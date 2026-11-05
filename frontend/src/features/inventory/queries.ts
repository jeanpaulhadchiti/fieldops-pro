import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSession, subscribeSession } from '../../services/session'
import { getInventoryItems, getInventoryCategories, getInventoryMovements, getStorageLocations } from './api'

export function useInventoryItems(organizationId: string | undefined, archived = false) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  return useQuery({
    queryKey: ['inventory', 'items', organizationId, session.version, archived],
    enabled: Boolean(organizationId && session.token),
    queryFn: ({ signal }) => getInventoryItems(organizationId!, signal, archived),
  })
}

export function useInventoryCategories(organizationId: string | undefined) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  return useQuery({
    queryKey: ['inventory', 'categories', organizationId, session.version],
    enabled: Boolean(organizationId && session.token),
    queryFn: ({ signal }) => getInventoryCategories(organizationId!, signal),
  })
}

export function useStorageLocations(organizationId: string | undefined) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  return useQuery({
    queryKey: ['inventory', 'locations', organizationId, session.version],
    enabled: Boolean(organizationId && session.token),
    queryFn: ({ signal }) => getStorageLocations(organizationId!, signal),
  })
}

export function useInventoryMovements(organizationId: string | undefined, itemId: string | undefined) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  return useQuery({
    queryKey: ['inventory', 'movements', organizationId, session.version, itemId],
    enabled: Boolean(organizationId && itemId && session.token),
    queryFn: ({ signal }) => getInventoryMovements(organizationId!, itemId!, signal),
  })
}

