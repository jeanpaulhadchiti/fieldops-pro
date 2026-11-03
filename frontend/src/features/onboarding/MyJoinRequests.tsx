import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { getErrorMessage } from '../../services/api'
import { getSession } from '../../services/session'
import { useAuth } from '../auth/useAuth'
import { formatEventDate } from '../events/format'
import { useOrganization } from '../organizations/useOrganization'
import { getOwnJoinRequests } from './api'
import { onboardingKeys } from './queryKeys'

export default function MyJoinRequests() {
  const { user } = useAuth()
  const scope = useOrganization()
  const navigate = useNavigate()
  const mounted = useRef(false)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<unknown>(null)
  const [refreshing, setRefreshing] = useState(false)
  const query = useQuery({ queryKey: onboardingKeys.ownRequests(user!.id, page), queryFn: ({ signal }) => getOwnJoinRequests(page, signal), refetchInterval: 30_000 })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function refresh(selectId?: string) {
    const version = getSession().version
    setRefreshing(true)
    setError(null)
    try {
      const requests = await query.refetch()
      if (requests.error) throw requests.error
      if (!mounted.current || getSession().version !== version) return
      await scope.refreshOrganizations(selectId)
      if (selectId && mounted.current && getSession().version === version) navigate('/dashboard')
    } catch (cause) { if (mounted.current && getSession().version === version) setError(cause) }
    finally { if (mounted.current && getSession().version === version) setRefreshing(false) }
  }

  return <Card className="overflow-hidden">
    <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:px-7"><div><h2 className="text-lg font-semibold text-slate-900">Your join requests</h2><p className="mt-1 text-xs leading-5 text-slate-500">Pending requests do not grant access. Status refreshes automatically while this page is open.</p></div><Button variant="secondary" busy={refreshing || query.isFetching} onClick={() => void refresh()}><RefreshCw className="size-4" aria-hidden="true" />Refresh requests</Button></div>
    {error != null && <p role="alert" className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800 sm:mx-7">{getErrorMessage(error)}</p>}
    {query.isPending ? <LoadingState label="Loading your join requests…" /> : query.isError ? <div className="p-5 sm:p-7"><ErrorState title="Unable to load your requests" error={query.error} onRetry={() => void refresh()} /></div> : !query.data.length ? <EmptyState title={page === 1 ? 'No join requests yet' : 'No more requests'} description={page === 1 ? 'Search for a discoverable organization to request membership. Only your own requests appear here.' : 'Return to the previous page to view your earlier requests.'} /> : <ul className="divide-y divide-slate-100">{query.data.map(request => <li key={request.id} className="p-5 sm:px-7"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold text-slate-900">{request.organization_name}</h3><p className="mt-1 text-xs leading-5 text-slate-500">Submitted <time dateTime={request.created_at}>{formatEventDate(request.created_at)}</time></p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${request.status === 'approved' ? 'bg-teal-50 text-teal-800' : request.status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{request.status[0].toUpperCase() + request.status.slice(1)}</span></div>
      {request.message && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{request.message}</p>}
      <p className="mt-3 text-xs leading-5 text-slate-500">{request.status === 'pending' ? 'Waiting for an Owner or Admin to review your request.' : request.status === 'rejected' ? 'This request was rejected. It grants no organization access.' : request.membership_active ? 'Your membership is active. Open the organization to continue.' : 'This request was approved earlier, but your membership is no longer active. Contact the organization to resolve access.'}</p>
      {request.reviewed_at && <p className="mt-1 text-xs leading-5 text-slate-500">Reviewed <time dateTime={request.reviewed_at}>{formatEventDate(request.reviewed_at)}</time></p>}
      {request.status === 'approved' && request.membership_active && <Button className="mt-4" variant="secondary" busy={refreshing} onClick={() => void refresh(request.organization_id)}>Open organization<ArrowRight className="size-4" aria-hidden="true" /></Button>}
    </li>)}</ul>}
    {(page > 1 || query.data?.length === 20) && <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-5 sm:px-7"><Button variant="secondary" disabled={page === 1 || query.isFetching || refreshing} onClick={() => setPage(value => value - 1)}>Newer requests</Button><span className="text-xs text-slate-500">Page {page}</span><Button variant="secondary" disabled={query.data?.length !== 20 || query.isFetching || refreshing} onClick={() => setPage(value => value + 1)}>Older requests</Button></div>}
  </Card>
}
