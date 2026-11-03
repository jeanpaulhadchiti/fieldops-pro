import { useId, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, RefreshCw, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui'
import ConfirmationDialog from '../../components/ui/ConfirmationDialog'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { ApiError, getErrorMessage } from '../../services/api'
import type { EventRecord } from '../../types/api'
import { useOrganization } from '../organizations/useOrganization'
import type { Participant } from '../participants/types'
import { acceptsRegistrations, availableParticipants } from './policies'
import { registrationKeys } from './queries'
import { createBulkRegistration } from './BulkRegistrationApi'
import BulkParticipantChecklist from './BulkParticipantChecklist'
import { BulkRegistrationValidationError, bulkOutcomeIsUncertain, bulkRegistrationIssues, bulkRemainingPlaces, bulkSelectionProblem, prepareBulkRequest } from './BulkRegistrationSelection'
import type { BulkRegistrationRequest, BulkRegistrationResult, Registration } from './types'

interface AttemptSnapshot { request: BulkRegistrationRequest; participants: Participant[] }
interface Submission { attempt: AttemptSnapshot; retry: boolean }

export default function RegistrationCreateForm({ event, participants, registrations, onCreated }: {
  event: EventRecord
  participants: Participant[]
  registrations: Registration[]
  onCreated: () => void
}) {
  const { organization, canManageEvents } = useOrganization()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [feeRequired, setFeeRequired] = useState(false)
  const [lastRequest, setLastRequest] = useState<BulkRegistrationRequest | null>(null)
  const [review, setReview] = useState<Submission | null>(null)
  const [recovery, setRecovery] = useState<AttemptSnapshot | null>(null)
  const [discardRecovery, setDiscardRecovery] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkRegistrationResult | null>(null)
  const available = availableParticipants(participants, registrations).filter(participant => participant.organization_id === event.organization_id)
  const eligibleIds = new Set(available.map(participant => participant.id))
  const currentIds = selectedIds.filter(id => eligibleIds.has(id))
  const selectedSet = new Set(currentIds)
  const registeredCount = registrations.filter(registration => registration.status === 'registered').length
  const remaining = bulkRemainingPlaces(event.capacity, registeredCount)
  const selectionProblem = bulkSelectionProblem(currentIds, eligibleIds, remaining)
  const refreshing = useIsFetching({ queryKey: registrationKeys.event(event.organization_id, event.id) }) > 0
  const refreshRegistrations = () => queryClient.invalidateQueries({ queryKey: registrationKeys.event(event.organization_id, event.id) })
  const create = useScopedMutation<BulkRegistrationResult, Submission>({
    mutationFn: ({ attempt, retry }) => {
      if (!organization || event.organization_id !== organization.id || attempt.request.event_id !== event.id || !canManageEvents) {
        throw new BulkRegistrationValidationError('You cannot add registrations to this event.')
      }
      if (!retry) {
        if (!acceptsRegistrations(event)) throw new BulkRegistrationValidationError('This event is no longer accepting registrations.')
        const problem = bulkSelectionProblem(attempt.request.participant_ids, eligibleIds, remaining)
        if (problem) throw new BulkRegistrationValidationError(problem)
      }
      // Replays must keep the original IDs even if a refresh now shows those
      // participants registered: the server returns the saved receipt by key.
      return createBulkRegistration(attempt.request)
    },
    onSuccess: async receipt => {
      setReview(null)
      setRecovery(null)
      setLastRequest(null)
      setSelectedIds([])
      setFeeRequired(false)
      setValidationError(null)
      setResult(receipt)
      onCreated()
      await refreshRegistrations()
    },
    onError: async (error, { attempt }) => {
      setReview(null)
      setRecovery(bulkOutcomeIsUncertain(error) ? attempt : null)
      if (error instanceof ApiError && error.status === 409) await refreshRegistrations()
    },
  })
  const issues = bulkRegistrationIssues(create.error instanceof ApiError ? create.error.detail : undefined)
  const names = new Map([...participants, ...(create.variables?.attempt.participants ?? [])].map(participant => [participant.id, participant.full_name]))
  const locked = create.isPending || Boolean(recovery)

  function updateSelection(next: string[]) {
    if (locked) return
    setSelectedIds(next)
    setLastRequest(null)
    setResult(null)
    setValidationError(null)
    create.reset()
  }

  function reviewSelection() {
    if (selectionProblem) { setValidationError(selectionProblem); return }
    const request = prepareBulkRequest(event.id, currentIds, feeRequired, lastRequest)
    setLastRequest(request)
    setValidationError(null)
    setReview({ attempt: { request, participants: available.filter(participant => selectedSet.has(participant.id)) }, retry: false })
  }

  if (!canManageEvents || (!acceptsRegistrations(event) && !recovery && !result && !create.isPending)) return null
  return <div className="border-b border-slate-100 bg-slate-50/60 p-5 sm:p-6">
    <h3 className="font-semibold text-slate-900">Register participants</h3>
    <p className="mt-1 text-sm leading-6 text-slate-500">Select one or more people from this organization’s participant directory, then review the batch before saving.</p>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600"><span>Capacity: <strong className="font-semibold text-slate-900">{event.capacity === null ? 'No limit' : event.capacity.toLocaleString()}</strong></span><span>Registered: <strong className="font-semibold text-slate-900">{registeredCount.toLocaleString()}</strong></span><span>Remaining places: <strong className="font-semibold text-slate-900">{remaining === null ? 'Unlimited' : remaining.toLocaleString()}</strong></span></div>
    {result && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900"><CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><div><p className="font-semibold">{result.created_count.toLocaleString()} {result.created_count === 1 ? 'participant registered' : 'participants registered'}.</p><p>{result.replayed ? 'The earlier saved batch was confirmed. This retry created no additional registrations.' : 'The entire batch was saved successfully.'}</p></div></div>}
    {create.isError && !recovery && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">The batch was not registered.</p><p className="mt-1 leading-6">{issues.length ? `${issues.length.toLocaleString()} validation ${issues.length === 1 ? 'issue needs' : 'issues need'} attention. No new registrations were created by this attempt.` : getErrorMessage(create.error)}</p>{issues.length > 0 && <ul className="mt-3 max-h-56 list-disc space-y-2 overflow-y-auto pl-5">{issues.map((issue, index) => {
      const id = issue.participantId ?? (issue.index === undefined ? undefined : create.variables?.attempt.request.participant_ids[issue.index])
      return <li key={`${id ?? 'batch'}-${index}`}><span className="font-medium">{id ? names.get(id) ?? 'Selected participant' : 'Batch'}: </span>{issue.message}</li>
    })}</ul>}</div>}
    {recovery && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><p className="flex items-center gap-2 font-semibold"><AlertCircle size={18} aria-hidden="true" />Confirm this batch’s outcome</p><p className="mt-2">The response for {recovery.request.participant_ids.length.toLocaleString()} selected participants could not be confirmed. The earlier request may already have saved. Retry the same batch to retrieve its result safely, even if these participants now appear registered.</p><p className="mt-2 text-xs text-amber-800">{getErrorMessage(create.error)}</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => setReview({ attempt: recovery, retry: true })} disabled={create.isPending}>Retry same batch</Button><Button variant="secondary" onClick={() => void refreshRegistrations()} busy={refreshing}><RefreshCw size={15} aria-hidden="true" />Refresh registrations</Button><Button variant="ghost" onClick={() => setDiscardRecovery(true)} disabled={create.isPending}>Change selection</Button></div></div>}
    {!acceptsRegistrations(event) ? null : !participants.length ? <p className="mt-4 text-sm leading-6 text-slate-600">Add your first participant to start registering your team. <Link to="/participants?create=1" className="font-semibold text-teal-700 hover:underline">Open participant directory</Link></p> : !available.length ? <p className="mt-4 text-sm leading-6 text-slate-600">Every participant already has a registration for this event. Cancelled registrations cannot be added again. <Link to="/participants?create=1" className="font-semibold text-teal-700 hover:underline">Add a new participant</Link></p> : <form noValidate onSubmit={form => { form.preventDefault(); reviewSelection() }} className="mt-5 space-y-4">
      <BulkParticipantChecklist participants={available} selectedIds={selectedSet} search={search} onSearch={setSearch} disabled={locked || remaining === 0} fieldId={fieldId} onSelectAll={() => updateSelection(available.map(participant => participant.id))} onDeselectAll={() => updateSelection([])} onToggle={id => updateSelection(selectedSet.has(id) ? currentIds.filter(value => value !== id) : [...currentIds, id])} />
      {remaining === 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">This event has reached its capacity. Registration will become available when space opens.</p>}
      {(validationError || (currentIds.length > 0 && selectionProblem)) && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{validationError ?? selectionProblem}</p>}
      <label className="flex items-start gap-2.5 text-sm leading-6 text-slate-600"><input checked={feeRequired} onChange={input => { if (locked) return; setFeeRequired(input.target.checked); setLastRequest(null); setResult(null); create.reset() }} disabled={locked} type="checkbox" className="mt-1 size-4 shrink-0 accent-teal-700" /><span>Fee required<span className="block text-xs text-slate-500">Records the fee requirement for every selected participant.</span></span></label>
      <Button type="submit" busy={create.isPending} disabled={locked || refreshing || Boolean(selectionProblem)}><UserPlus size={16} aria-hidden="true" />{create.isPending ? 'Registering participants…' : `Register Selected${currentIds.length ? ` (${currentIds.length.toLocaleString()})` : ''}`}</Button>
    </form>}
    <ConfirmationDialog open={Boolean(review)} title={review?.retry ? 'Confirm the earlier batch' : 'Review participant registrations'} description={review ? `${review.attempt.request.participant_ids.length.toLocaleString()} ${review.attempt.request.participant_ids.length === 1 ? 'participant' : 'participants'} for ${event.title}. ${review.retry ? 'The exact earlier request will be retried without creating duplicates.' : 'The batch is saved together only if every selected participant is valid and capacity is available.'}` : undefined} confirmLabel={review?.retry ? 'Confirm same batch' : 'Confirm registration'} onConfirm={() => { if (review) create.mutate(review) }} onCancel={() => { if (!create.isPending) setReview(null) }} busy={create.isPending}>
      {review && <div className="space-y-4"><p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Fee required: <strong className="font-semibold text-slate-900">{review.attempt.request.fee_required ? 'Yes, for every selected participant' : 'No'}</strong></p><div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-3"><ul aria-label="Participants to register" className="space-y-2 text-sm text-slate-700">{review.attempt.participants.map(participant => <li key={participant.id} className="break-words">{participant.full_name}</li>)}</ul></div></div>}
    </ConfirmationDialog>
    <ConfirmationDialog open={discardRecovery} title="Change the batch selection?" description="The earlier request may already have saved. Refresh registrations before choosing another batch. Clearing this retry clears your selection; saved registrations remain." confirmLabel="Clear batch selection" onConfirm={() => { setDiscardRecovery(false); setRecovery(null); setLastRequest(null); setSelectedIds([]); setFeeRequired(false); setValidationError(null); create.reset(); void refreshRegistrations() }} onCancel={() => setDiscardRecovery(false)} />
  </div>
}
