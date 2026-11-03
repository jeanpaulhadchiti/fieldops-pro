import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleX, RefreshCw, Search, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { getErrorMessage } from '../../services/api'
import type { EventRecord } from '../../types/api'
import { formatEventDate } from '../events/format'
import { useOrganization } from '../organizations/useOrganization'
import { useParticipants } from '../participants/queries'
import { acceptsRegistrations, canCancelRegistration, canMarkAttendance } from './policies'
import { cancelRegistration, markRegistrationAttendance, registrationKeys, useRegistrations } from './queries'
import RegistrationCreateForm from './RegistrationCreateForm'
import type { Registration } from './types'

interface RegistrationAction { kind: 'attendance' | 'cancel'; registration: Registration }

export default function EventRegistrations({ event }: { event: EventRecord }) {
  const { organization, canManageEvents } = useOrganization()
  const inScope = organization?.id === event.organization_id
  const participantsQuery = useParticipants(inScope ? organization.id : undefined)
  const registrationsQuery = useRegistrations(inScope ? organization.id : undefined, inScope ? event.id : undefined)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const action = useScopedMutation<Registration, RegistrationAction>({
    mutationFn: ({ kind, registration }) => {
      if (!inScope || !canManageEvents || registration.event_id !== event.id || !registrationsQuery.data?.some(row => row.id === registration.id)) {
        throw new Error('You do not have permission to update this registration.')
      }
      if (kind === 'attendance') {
        if (!canMarkAttendance(event, registration)) throw new Error('Attendance can only be recorded for a current registration while the event is active.')
        return markRegistrationAttendance(registration.id)
      }
      if (!canCancelRegistration(registration) || event.archived_at) throw new Error('This registration cannot be cancelled.')
      return cancelRegistration(registration.id)
    },
    onSuccess: async (_registration, variables) => {
      setNotice(variables.kind === 'attendance' ? 'Attendance has been recorded.' : 'The registration has been cancelled.')
      await queryClient.invalidateQueries({ queryKey: registrationKeys.event(event.organization_id, event.id) })
    },
  })

  if (!inScope) return <ErrorState error={new Error('This event is not available in the selected organization.')} />
  const registrations = registrationsQuery.data ?? []
  const participants = participantsQuery.data ?? []
  const names = new Map(participants.map(participant => [participant.id, participant.full_name]))
  const filtered = registrations.filter(registration => (names.get(registration.participant_id) ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const registeredCount = registrations.filter(registration => registration.status === 'registered').length
  const attendedCount = registrations.filter(registration => registration.attended_at).length

  function runAction(kind: RegistrationAction['kind'], registration: Registration) {
    if (action.isPending) return
    const name = names.get(registration.participant_id) ?? 'this participant'
    if (kind === 'cancel' && !window.confirm(`Cancel the registration for ${name}? This participant cannot be registered again for this event.`)) return
    setNotice('')
    action.mutate({ kind, registration })
  }

  return <section id="event-registrations" aria-labelledby="event-registrations-title" className="scroll-mt-6">
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
        <div><h2 id="event-registrations-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Users size={20} className="text-teal-700" aria-hidden="true" />Participants & registrations</h2><p className="mt-1 text-sm leading-6 text-slate-500">Registrations, attendance, and fee metadata for this event.</p></div>
        <div className="flex flex-wrap items-center gap-3"><Link to="/participants" className="text-sm font-semibold text-teal-700 hover:underline">Participant directory</Link><Button variant="ghost" className="px-3 py-2 text-xs" disabled={action.isPending} busy={participantsQuery.isFetching || registrationsQuery.isFetching} onClick={() => { void participantsQuery.refetch(); void registrationsQuery.refetch() }}><RefreshCw size={14} aria-hidden="true" />Refresh</Button></div>
      </div>
      {participantsQuery.isPending || registrationsQuery.isPending ? <LoadingState label="Loading event registrations…" /> : participantsQuery.isError || registrationsQuery.isError ? <div className="p-5 sm:p-6"><ErrorState error={participantsQuery.error ?? registrationsQuery.error} onRetry={() => { void participantsQuery.refetch(); void registrationsQuery.refetch() }} /></div> : <>
        {notice && <p role="status" className="mx-5 mt-5 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 sm:mx-6"><CheckCircle2 size={16} aria-hidden="true" />{notice}</p>}
        {action.isError && <p role="alert" className="mx-5 mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:mx-6">{getErrorMessage(action.error)}</p>}
        {canManageEvents && <RegistrationCreateForm event={event} participants={participants} registrations={registrations} onCreated={() => { action.reset(); setNotice('The registration batch has been saved.') }} />}
        {!acceptsRegistrations(event) && <p className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs leading-6 text-slate-500 sm:px-6">This event is no longer accepting registrations.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"><p className="text-sm text-slate-500"><span className="font-semibold text-slate-800">{registeredCount}</span> registered · <span className="font-semibold text-slate-800">{attendedCount}</span> attended{event.capacity !== null && <> · capacity {event.capacity}</>}</p><div className="relative w-full sm:w-60"><label htmlFor="registration-search" className="sr-only">Search registered participants</label><Search size={16} className="pointer-events-none absolute top-3 left-3 text-slate-400" aria-hidden="true" /><input id="registration-search" type="search" value={search} onChange={event => setSearch(event.target.value)} className={`${inputClassName} pl-9`} placeholder="Search registrations" /></div></div>
        {!registrations.length ? <EmptyState title="No registrations yet" description={canManageEvents && acceptsRegistrations(event) ? 'Select a participant above to add the first registration.' : 'Participants will appear here when an Owner or Admin registers them.'} /> : !filtered.length ? <EmptyState title="No matching registrations" description="Try another participant name or clear your search." action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>} /> : <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {filtered.map(registration => <li key={registration.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start sm:px-6">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link to={`/participants/${registration.participant_id}?event=${event.id}`} className="break-words text-sm font-semibold text-slate-900 hover:text-teal-700 hover:underline">{names.get(registration.participant_id) ?? 'Participant unavailable'}</Link><StatusBadge status={registration.status} /></div>
              <p className="mt-2 text-xs leading-6 text-slate-500">{registration.attended_at ? <span className="text-teal-700">Attended {formatEventDate(registration.attended_at)}</span> : 'Not marked attended'}<span className="mx-2" aria-hidden="true">·</span>{registration.fee_required ? `Fee required · ${registration.payment_status ?? 'Unpaid'}` : 'No fee required'}</p>
              <p className="text-xs leading-6 text-slate-400">Registered {formatEventDate(registration.created_at)}</p>
            </div>
            {canManageEvents && !event.archived_at && (canMarkAttendance(event, registration) || canCancelRegistration(registration)) && <div className="flex shrink-0 flex-wrap gap-2">{canMarkAttendance(event, registration) && <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => runAction('attendance', registration)} disabled={action.isPending} busy={action.isPending && action.variables?.kind === 'attendance' && action.variables.registration.id === registration.id}><CheckCircle2 size={15} aria-hidden="true" />Mark attended</Button>}{canCancelRegistration(registration) && <Button variant="ghost" className="px-3 py-2 text-xs text-red-700 hover:bg-red-50" onClick={() => runAction('cancel', registration)} disabled={action.isPending} busy={action.isPending && action.variables?.kind === 'cancel' && action.variables.registration.id === registration.id}><CircleX size={15} aria-hidden="true" />Cancel</Button>}</div>}
          </li>)}
        </ul>}
        {event.status === 'planned' && canManageEvents && <p className="border-t border-slate-100 px-5 py-3 text-xs leading-6 text-slate-400 sm:px-6">Attendance becomes available when the event is Active.</p>}
      </>}
    </Card>
  </section>
}
