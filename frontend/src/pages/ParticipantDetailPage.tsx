import { ArrowLeft, Building2, CalendarDays, UserRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { z } from 'zod'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { buttonClassName } from '../components/ui/styles'
import { formatEventDate, localTimeZone } from '../features/events/format'
import { useOrganization } from '../features/organizations/useOrganization'
import { useParticipants } from '../features/participants/queries'
import ParticipantRegistrationLookup from '../features/registrations/ParticipantRegistrationLookup'

export default function ParticipantDetailPage() {
  const { participantId = '' } = useParams()
  const { organization } = useOrganization()
  const validId = z.uuid().safeParse(participantId).success
  // The backend exposes an organization list, not an individual participant endpoint.
  const query = useParticipants(validId ? organization?.id : undefined)
  const participant = query.data?.find(item => item.id === participantId)

  if (!validId) return <EmptyState title="Participant not found" description="This participant link is invalid. Return to the participant directory." action={<Link to="/participants" className={buttonClassName('secondary')}>Back to participants</Link>} />
  return <div className="space-y-6">
    <Link to="/participants" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-teal-700"><ArrowLeft size={16} aria-hidden="true" />Back to participants</Link>
    {query.isPending ? <LoadingState label="Loading participant details…" /> : query.isError ? <ErrorState title="Unable to load this participant" error={query.error} onRetry={() => void query.refetch()} /> : !participant ? <EmptyState title="Participant not found" description="This participant is not available in the selected organization. Choose the correct organization or return to the directory." action={<Link to="/participants" className={buttonClassName('secondary')}>Back to participants</Link>} /> : <>
      <PageHeader eyebrow={organization?.name} title={participant.full_name} description="Participant profile and event registration information." />
      <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6"><div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700"><UserRound size={25} aria-hidden="true" /></div><h2 className="font-semibold text-slate-900">Participant details</h2><dl className="mt-5 space-y-5 text-sm"><div><dt className="flex items-center gap-2 text-xs font-medium text-slate-500"><UserRound size={14} aria-hidden="true" />Full name</dt><dd className="mt-2 break-words font-medium text-slate-800">{participant.full_name}</dd></div><div><dt className="flex items-center gap-2 text-xs font-medium text-slate-500"><Building2 size={14} aria-hidden="true" />Organization</dt><dd className="mt-2 break-words text-slate-700">{organization?.name}</dd></div><div><dt className="flex items-center gap-2 text-xs font-medium text-slate-500"><CalendarDays size={14} aria-hidden="true" />Added on</dt><dd className="mt-2 text-slate-700"><time dateTime={participant.created_at}>{formatEventDate(participant.created_at)}</time></dd></div></dl><p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-6 text-slate-400">Dates shown in {localTimeZone}.</p></Card>
        <ParticipantRegistrationLookup key={participant.id} participant={participant} />
      </div>
    </>}
  </div>
}
