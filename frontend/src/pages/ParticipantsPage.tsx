import { useState } from 'react'
import { ArrowUpRight, CheckCircle2, FileSpreadsheet, Search, UserPlus, Users } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { inputClassName } from '../components/ui/styles'
import { formatEventDate } from '../features/events/format'
import { useOrganization } from '../features/organizations/useOrganization'
import ParticipantCreateForm from '../features/participants/ParticipantCreateForm'
import ParticipantImportPanel from '../features/participants/import/ParticipantImportPanel'
import { useParticipants } from '../features/participants/queries'
import type { Participant } from '../features/participants/types'

export default function ParticipantsPage() {
  const { organization, canManageEvents } = useOrganization()
  const query = useParticipants(organization?.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [created, setCreated] = useState<Participant | null>(null)
  const showCreate = canManageEvents && searchParams.get('create') === '1'
  const showImport = canManageEvents && searchParams.get('import') === '1'
  const participants = query.data ?? []
  const filtered = participants.filter(participant => participant.full_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  function toggleCreate(show: boolean) {
    const params = new URLSearchParams(searchParams)
    if (show) { params.set('create', '1'); params.delete('import') }
    else params.delete('create')
    setSearchParams(params, { replace: true })
  }

  function toggleImport(show: boolean) {
    const params = new URLSearchParams(searchParams)
    if (show) { params.set('import', '1'); params.delete('create') }
    else params.delete('import')
    setSearchParams(params, { replace: true })
  }

  return <div className="space-y-6">
    <PageHeader eyebrow={organization?.name} title="Participants" description="The people who take part in your organization’s events." action={canManageEvents && !showCreate && !showImport ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setCreated(null); toggleImport(true) }}><FileSpreadsheet size={17} aria-hidden="true" />Import participants</Button><Button onClick={() => { setCreated(null); toggleCreate(true) }}><UserPlus size={17} aria-hidden="true" />Add participant</Button></div> : undefined} />
    {created && <p role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900"><CheckCircle2 size={17} aria-hidden="true" /><span>{created.full_name} has been added.</span><Link to={`/participants/${created.id}`} className="font-semibold underline">View participant</Link></p>}
    {showCreate && <Card className="mx-auto max-w-2xl p-5 sm:p-7"><ParticipantCreateForm onCancel={() => toggleCreate(false)} onCreated={participant => { setCreated(participant); setSearch(''); toggleCreate(false) }} /></Card>}
    {showImport && <ParticipantImportPanel onClose={() => toggleImport(false)} onImported={() => setSearch('')} />}
    <Card className="overflow-hidden">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:px-6">
        <div><h2 className="flex items-center gap-2 font-semibold text-slate-900"><Users size={18} className="text-teal-700" aria-hidden="true" />Participant directory</h2><p className="mt-1 text-xs leading-5 text-slate-500">{query.isSuccess ? `${participants.length} ${participants.length === 1 ? 'participant' : 'participants'} in this organization` : 'Organization-scoped participant records'}</p></div>
        <div className="relative w-full sm:w-72"><label htmlFor="participant-search" className="sr-only">Search participants by name</label><Search size={17} className="pointer-events-none absolute top-3 left-3 text-slate-400" aria-hidden="true" /><input id="participant-search" type="search" value={search} onChange={event => setSearch(event.target.value)} className={`${inputClassName} pl-9`} placeholder="Search participants by name" /></div>
      </div>
      {query.isPending ? <LoadingState label="Loading participants…" /> : query.isError ? <div className="p-5 sm:p-6"><ErrorState title="Unable to load participants" error={query.error} onRetry={() => void query.refetch()} /></div> : !participants.length ? <EmptyState title="Your participant directory starts here" description={canManageEvents ? 'Add your first participant, then register them for an event.' : 'Participants will appear here when an Owner or Admin adds them.'} action={canManageEvents && !showCreate && !showImport ? <Button onClick={() => toggleCreate(true)}><UserPlus size={16} aria-hidden="true" />Add participant</Button> : undefined} /> : !filtered.length ? <EmptyState title="No matching participants" description="Try another name or clear your search to see the full directory." action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>} /> : <ul className="divide-y divide-slate-100">
        {filtered.map(participant => <li key={participant.id}><Link to={`/participants/${participant.id}`} className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50 sm:px-6"><span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-semibold text-teal-800">{participant.full_name.trim().slice(0, 2).toLocaleUpperCase()}</span><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold text-slate-900 group-hover:text-teal-700">{participant.full_name}</h3><p className="mt-1 text-xs leading-5 text-slate-500">Added <time dateTime={participant.created_at}>{formatEventDate(participant.created_at)}</time></p></div><span className="hidden text-xs font-medium text-slate-400 sm:block">View details</span><ArrowUpRight size={17} className="shrink-0 text-slate-400 group-hover:text-teal-700" aria-hidden="true" /></Link></li>)}
      </ul>}
    </Card>
    {!canManageEvents && <p className="px-1 text-xs leading-6 text-slate-500">You can view participants and their event registrations. An Owner or Admin can add participants.</p>}
  </div>
}
