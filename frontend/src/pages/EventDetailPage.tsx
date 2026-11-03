import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, MapPin, Users } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { z } from 'zod'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/ui'
import { buttonClassName } from '../components/ui/styles'
import { formatEventDate, localTimeZone } from '../features/events/format'
import { useEvent } from '../features/events/queries'
import EventStatusActions from '../features/events/EventStatusActions'
import { useOrganization } from '../features/organizations/useOrganization'
import EventRegistrations from '../features/registrations/EventRegistrations'
import EventTasks from '../features/tasks/EventTasks'

export default function EventDetailPage() {
  const { eventId = '' } = useParams()
  const { organization } = useOrganization()
  const location = useLocation()
  const validId = z.uuid().safeParse(eventId).success
  const eventQuery = useEvent(organization?.id, eventId, validId)
  const event = eventQuery.data

  useEffect(() => {
    if (event && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [event, location.hash])

  if (!validId) return <EmptyState title="Event not found" description="This event link is invalid. Return to your organization’s event list." action={<Link to="/events" className={buttonClassName('secondary')}>Back to events</Link>} />

  return (
    <div className="space-y-6">
      <Link to="/events" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-teal-700"><ArrowLeft size={16} aria-hidden="true" />Back to events</Link>
      {eventQuery.isPending ? <LoadingState label="Loading event details…" /> : eventQuery.isError ? <ErrorState title="Unable to open this event" error={eventQuery.error} onRetry={() => void eventQuery.refetch()} /> : event ? (
        <>
          {location.state?.created && <div role="status" className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900"><CheckCircle2 size={17} aria-hidden="true" />Your event has been created.</div>}
          <PageHeader eyebrow={organization?.name} title={event.title} description="Event overview and schedule." action={<StatusBadge status={event.status} />} />
          <nav aria-label="Event sections" className="flex flex-wrap gap-2 border-b border-slate-200 pb-4 text-sm font-semibold text-teal-700"><a href="#overview" className="rounded-lg px-3 py-2 hover:bg-teal-50">Overview</a><a href="#event-registrations" className="rounded-lg px-3 py-2 hover:bg-teal-50">Registrations & attendance</a><a href="#tasks" className="rounded-lg px-3 py-2 hover:bg-teal-50">Tasks & assignments</a></nav>
          <EventStatusActions key={`status-${event.id}`} event={event} />
          <div id="overview" className="grid scroll-mt-6 items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Card className="p-5 sm:p-7">
              <h2 className="text-lg font-semibold text-slate-900">About this event</h2>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{event.description || 'No description has been added for this event.'}</p>
              <div className="mt-7 border-t border-slate-100 pt-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MapPin size={17} className="text-teal-700" aria-hidden="true" />Location</h3>
                <p className="mt-2 break-words text-sm leading-6 text-slate-600">{event.location || 'Location to be confirmed'}</p>
              </div>
            </Card>
            <Card className="p-5 sm:p-7">
              <h2 className="text-lg font-semibold text-slate-900">Event details</h2>
              <dl className="mt-5 space-y-5">
                <div><dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><CalendarDays size={15} aria-hidden="true" />Starts</dt><dd className="mt-2 text-sm font-medium text-slate-800"><time dateTime={event.start_at}>{formatEventDate(event.start_at)}</time></dd></div>
                <div><dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Clock3 size={15} aria-hidden="true" />Ends</dt><dd className="mt-2 text-sm font-medium text-slate-800"><time dateTime={event.end_at}>{formatEventDate(event.end_at)}</time></dd></div>
                <div><dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Users size={15} aria-hidden="true" />Capacity</dt><dd className="mt-2 text-sm font-medium text-slate-800">{event.capacity === null ? 'No capacity limit' : `${event.capacity.toLocaleString()} participants`}</dd></div>
              </dl>
              <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">Dates shown in {localTimeZone}.<br />Created {formatEventDate(event.created_at)}.</p>
            </Card>
          </div>
          <EventRegistrations key={`registrations-${event.id}`} event={event} />
          <EventTasks key={`tasks-${event.id}`} event={event} />
        </>
      ) : null}
    </div>
  )
}
