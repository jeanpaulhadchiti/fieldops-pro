import { ArrowRight, CalendarDays } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui'
import { buttonClassName } from '../../components/ui/styles'
import EventPicker from '../events/EventPicker'
import { formatEventDate } from '../events/format'
import { useEvent } from '../events/queries'
import { useOrganization } from '../organizations/useOrganization'
import type { Participant } from '../participants/types'
import { useRegistrations } from './queries'
import RegistrationInfo from './RegistrationInfo'

export default function ParticipantRegistrationLookup({ participant }: { participant: Participant }) {
  const { organization } = useOrganization()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('event') ?? ''
  const validId = z.uuid().safeParse(selectedId).success
  const eventQuery = useEvent(organization?.id, selectedId, validId)
  const selectedEvent = validId && eventQuery.isSuccess ? eventQuery.data : undefined
  const registrationsQuery = useRegistrations(organization?.id, selectedEvent?.id)
  const registration = registrationsQuery.data?.find(row => row.participant_id === participant.id)

  function selectEvent(id: string) {
    const params = new URLSearchParams(searchParams)
    if (id) params.set('event', id)
    else params.delete('event')
    setSearchParams(params, { replace: true })
  }

  return <Card className="overflow-hidden">
    <div className="border-b border-slate-100 p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><CalendarDays size={19} className="text-teal-700" aria-hidden="true" />Event registration</h2><p className="mt-2 text-sm leading-6 text-slate-500">Choose an event to see this participant’s registration and attendance. Only the selected event is checked.</p></div>
    <div className="border-b border-slate-100 p-5 sm:p-6"><EventPicker value={selectedId} selectedEvent={selectedEvent} onChange={event => selectEvent(event?.id ?? '')} label="Selected event" /></div>
    {!selectedId ? <EmptyState title="Choose an event" description="Registration and attendance details will appear here for the event you select." /> : !validId ? <div className="p-5 sm:p-6"><ErrorState title="Invalid event selection" error={new Error('Choose an event from this organization’s event list.')} /></div> : eventQuery.isPending ? <LoadingState label="Checking the selected event…" /> : eventQuery.isError ? <div className="p-5 sm:p-6"><ErrorState title="Unable to open the selected event" error={eventQuery.error} onRetry={() => void eventQuery.refetch()} /></div> : selectedEvent && <div className="space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{selectedEvent.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{formatEventDate(selectedEvent.start_at)}</p></div><StatusBadge status={selectedEvent.status} /></div>
      {registrationsQuery.isPending ? <LoadingState label="Loading registration information…" /> : registrationsQuery.isError ? <ErrorState error={registrationsQuery.error} onRetry={() => void registrationsQuery.refetch()} /> : registration ? <RegistrationInfo registration={registration} /> : <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">This participant has no registration for the selected event.</p>}
      <Link to={`/events/${selectedEvent.id}#event-registrations`} className={buttonClassName('secondary')}>Open event registrations<ArrowRight size={15} aria-hidden="true" /></Link>
    </div>}
  </Card>
}
