import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Check, RefreshCw, X } from 'lucide-react'
import ConfirmationDialog from '../../../components/ui/ConfirmationDialog'
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, StatusBadge } from '../../../components/ui'
import { inputClassName } from '../../../components/ui/styles'
import { useScopedMutation } from '../../../hooks/useScopedMutation'
import { getErrorMessage } from '../../../services/api'
import { useOrganization } from '../useOrganization'
import { getJoinRequests, reviewJoinRequest } from './api'
import { administrationKeys } from './policies'
import type { JoinRequestReview, JoinRequestStatus, ReviewDecision } from './types'

const displayDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function JoinRequestsPanel({ userId, organizationId }: { userId: string; organizationId: string }) {
  const { retry } = useOrganization()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedRequest = searchParams.get('request') || undefined
  const [status, setStatus] = useState<JoinRequestStatus | ''>(() => {
    const target = searchParams.get('status')
    return searchParams.has('request') && (target === 'approved' || target === 'rejected') ? target : 'pending'
  })
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<{ request: JoinRequestReview; decision: ReviewDecision } | null>(null)
  const requests = useQuery({
    queryKey: [...administrationKeys.requests(userId, organizationId, status, page), linkedRequest ?? null],
    queryFn: ({ signal }) => getJoinRequests(organizationId, status, page, signal, linkedRequest),
    staleTime: 0,
  })
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['organization-join-requests', userId, organizationId] }),
      queryClient.invalidateQueries({ queryKey: administrationKeys.members(userId, organizationId) }),
      queryClient.invalidateQueries({ queryKey: ['organizations'] }),
      queryClient.invalidateQueries({ queryKey: ['my-join-requests'] }),
    ])
  }
  const review = useScopedMutation<JoinRequestReview, { request: JoinRequestReview; decision: ReviewDecision }>({
    mutationFn: selection => reviewJoinRequest(organizationId, selection.request.id, selection.decision),
    onSuccess: async (result) => {
      await refresh()
      setConfirmation(null)
      setNotice(result.status === 'approved' ? `${result.applicant_name}’s request was approved. Their active membership is available in Members.` : `${result.applicant_name}’s request was rejected. No access was granted.`)
    },
    onError: async () => { await refresh(); retry() },
  })

  function choose(request: JoinRequestReview, decision: ReviewDecision) {
    review.reset()
    setNotice('')
    setConfirmation({ request, decision })
  }

  return <section aria-labelledby="join-requests-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="join-requests-heading" className="text-xl font-semibold text-slate-900">Join requests</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Review applications to this organization. Approval grants ordinary Member access; it never grants ownership or Admin permissions.</p></div><Button variant="secondary" onClick={() => void refresh()} busy={requests.isFetching} disabled={review.isPending}><RefreshCw size={15} aria-hidden="true" />Refresh requests</Button></div>
    {notice && <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900">{notice}</p>}
    <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">Account email addresses are not verified. Confirm the applicant’s identity through a trusted channel before granting access.</p>
    {linkedRequest && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-teal-50 p-4 text-sm text-teal-900"><span>Showing the join request linked from your notification.</span><Button variant="secondary" onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('request'); next.delete('status'); return next })}>Show all requests</Button></div>}
    <div className="max-w-xs"><Field htmlFor="request-status" label="Request status"><select id="request-status" value={status} className={inputClassName} disabled={review.isPending} onChange={event => { setStatus(event.target.value as JoinRequestStatus | ''); setPage(1); setNotice('') }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All statuses</option></select></Field></div>
    {requests.isPending ? <LoadingState label="Loading join requests…" /> : requests.isError ? <ErrorState title="Unable to load join requests" error={requests.error} onRetry={() => void requests.refetch()} /> : requests.data.length === 0 ? <Card><EmptyState title="No requests in this view" description={status === 'pending' ? 'New applications appear here when someone requests access to your discoverable organization.' : 'Choose another status or refresh to see the latest requests.'} /></Card> : <div className="space-y-3">
      {requests.data.map(request => <Card key={request.id} className="p-5 sm:p-6"><article aria-labelledby={`applicant-${request.id}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 id={`applicant-${request.id}`} className="break-words font-semibold text-slate-900">{request.applicant_name}</h3><p className="mt-1 break-all text-sm text-slate-600">{request.applicant_email}</p><p className="mt-2 break-words text-xs leading-5 text-slate-500">{request.organization_name} · Submitted <time dateTime={request.created_at}>{displayDate(request.created_at)}</time></p></div><StatusBadge status={request.status} /></div>
        <p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{request.message || 'No message provided.'}</p>
        {request.reviewed_at && <p className="mt-3 text-xs leading-5 text-slate-500">Reviewed <time dateTime={request.reviewed_at}>{displayDate(request.reviewed_at)}</time>{request.status === 'approved' && !request.membership_active ? ' · Membership is currently inactive; this past approval does not restore access.' : ''}</p>}
        {request.status === 'pending' && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs leading-5 text-slate-500">{request.user_id === userId ? 'You cannot review your own request.' : request.membership_active ? 'This applicant already has an active membership. Review resolves the pending request without creating another membership.' : 'Pending requests have no access to organization data.'}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={review.isPending || request.user_id === userId} onClick={() => choose(request, 'reject')} aria-label={`Reject ${request.applicant_name}’s request`}><X size={15} aria-hidden="true" />Reject</Button><Button disabled={review.isPending || request.user_id === userId} onClick={() => choose(request, 'approve')} aria-label={`Approve ${request.applicant_name}’s request`}><Check size={15} aria-hidden="true" />Approve</Button></div></div>}
      </article></Card>)}
    </div>}
    {requests.isSuccess && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500"><span>Page {page} · up to 25 requests per page</span><div className="flex gap-2"><Button variant="secondary" disabled={page === 1 || requests.isFetching || review.isPending} onClick={() => setPage(value => value - 1)}>Previous requests</Button><Button variant="secondary" disabled={requests.data.length < 25 || requests.isFetching || review.isPending} onClick={() => setPage(value => value + 1)}>Next requests</Button></div></div>}
    <ConfirmationDialog open={Boolean(confirmation)} title={confirmation?.decision === 'approve' ? 'Approve join request?' : 'Reject join request?'} description={confirmation ? `${confirmation.request.applicant_name} (${confirmation.request.applicant_email}) requested access to ${confirmation.request.organization_name}. ${confirmation.decision === 'approve' ? 'Approval creates or restores an ordinary Member membership. Existing privileged memberships require separate manual review.' : 'Rejection grants no membership or access.'}` : undefined} confirmLabel={confirmation?.decision === 'approve' ? 'Approve request' : 'Reject request'} danger={confirmation?.decision === 'reject'} busy={review.isPending} onCancel={() => { setConfirmation(null); review.reset() }} onConfirm={() => { if (confirmation) review.mutate(confirmation) }}>
      {review.isError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(review.error)}</p>}
    </ConfirmationDialog>
  </section>
}
