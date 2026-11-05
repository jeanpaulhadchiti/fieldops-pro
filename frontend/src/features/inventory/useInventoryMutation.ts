import { useQueryClient } from '@tanstack/react-query'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { getSession } from '../../services/session'
import { useOrganization } from '../organizations/useOrganization'

interface Options<TData, TVariables> {
  organizationId: string
  mutationFn: (variables: TVariables) => Promise<TData>
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>
}

/** Retain the submission's scope, and let the server arbitrate concurrent writes. */
export function useInventoryMutation<TData, TVariables>({ organizationId, mutationFn, onSuccess }: Options<TData, TVariables>) {
  const scope = useOrganization()
  const queryClient = useQueryClient()
  return useScopedMutation({
    mutationFn: async (variables: TVariables) => {
      if (scope.isLoading || scope.error || scope.organization?.id !== organizationId || scope.organization.archived_at ||
        scope.membership?.status !== 'active' || !['Owner', 'Admin'].includes(scope.membership.role)) {
        throw new Error('Inventory changes require an active Owner or Admin in the selected, active workspace.')
      }
      const version = getSession().version
      try {
        return await mutationFn(variables)
      } finally {
        // A rejected concurrent write may mean the displayed balance is stale too.
        if (getSession().version === version) {
          const filters = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === 'inventory' && query.queryKey[2] === organizationId }
          // Initial paginated reads must restart too: invalidation alone can join
          // an old fetch whose first page predates this write.
          await queryClient.cancelQueries(filters)
          if (getSession().version === version) await queryClient.invalidateQueries(filters)
        }
      }
    },
    onSuccess,
  })
}
