import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useOrganization } from '../features/organizations/useOrganization'
import { getSession } from '../services/session'

interface Options<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>
  onError?: (error: Error, variables: TVariables) => void | Promise<void>
}

interface Submission<TVariables> {
  variables: TVariables
  sessionVersion: number
  organizationId: string | null
}

/** Discard callbacks from a workspace/session that the user has already left. */
export function useScopedMutation<TData, TVariables>({ mutationFn, onSuccess, onError }: Options<TData, TVariables>) {
  const { organization } = useOrganization()
  const queryClient = useQueryClient()
  const scope = useRef<string | null>(organization?.id ?? null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  useEffect(() => {
    mounted.current = true
    scope.current = organization?.id ?? null
    return () => { mounted.current = false; scope.current = null }
  }, [organization?.id])

  const mutation = useMutation<TData, Error, Submission<TVariables>>({
    mutationFn: ({ variables, sessionVersion, organizationId }) => {
      if (!mounted.current || getSession().version !== sessionVersion || scope.current !== organizationId) {
        throw new Error('Your workspace or session changed. Please try again in the current workspace.')
      }
      return mutationFn(variables)
    },
    onSuccess: async (data, submission) => {
      if (getSession().version === submission.sessionVersion && submission.organizationId) {
        // A save may finish after navigation. Mark that workspace's existing
        // reads stale without fetching into a workspace the user has left.
        await queryClient.invalidateQueries({
          predicate: query => query.queryKey.some(part => part === submission.organizationId),
          refetchType: 'none',
        })
      }
      if (mounted.current && getSession().version === submission.sessionVersion && scope.current === submission.organizationId) {
        await onSuccess?.(data, submission.variables)
      }
    },
    onError: async (error, submission) => {
      if (mounted.current && getSession().version === submission.sessionVersion && scope.current === submission.organizationId) {
        await onError?.(error, submission.variables)
      }
    },
    onSettled: () => { submitting.current = false },
  })

  function submission(variables: TVariables): Submission<TVariables> {
    return { variables, sessionVersion: getSession().version, organizationId: organization?.id ?? null }
  }

  return {
    ...mutation,
    variables: mutation.variables?.variables,
    mutate: (variables: TVariables) => {
      if (submitting.current) return
      submitting.current = true
      mutation.mutate(submission(variables))
    },
    mutateAsync: async (variables: TVariables) => {
      if (submitting.current) throw new Error('A request is already in progress. Please wait for it to finish.')
      submitting.current = true
      return mutation.mutateAsync(submission(variables))
    },
  }
}
