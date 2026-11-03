import { Search } from 'lucide-react'
import { Button } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import type { Participant } from '../participants/types'
import { filterBulkParticipants, maximumBulkParticipants } from './BulkRegistrationSelection'

export default function BulkParticipantChecklist({ participants, selectedIds, search, onSearch, onToggle, onSelectAll, onDeselectAll, disabled, fieldId }: {
  participants: Participant[]
  selectedIds: ReadonlySet<string>
  search: string
  onSearch: (value: string) => void
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  disabled: boolean
  fieldId: string
}) {
  const filtered = filterBulkParticipants(participants, search)
  return <div className="space-y-3">
    <div className="relative"><label className="sr-only" htmlFor={`${fieldId}-search`}>Search eligible participants</label><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" /><input id={`${fieldId}-search`} type="search" className={`${inputClassName} pl-9`} value={search} onChange={event => onSearch(event.target.value)} placeholder="Search eligible participants by name" disabled={disabled} /></div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p id={`${fieldId}-count`} className="text-sm text-slate-600" role="status"><span className="font-semibold text-slate-900">{selectedIds.size.toLocaleString()}</span> selected · {participants.length.toLocaleString()} eligible</p>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" className="px-3 py-2 text-xs" disabled={disabled || !participants.length} onClick={onSelectAll}>Select All Eligible</Button><Button variant="ghost" className="px-3 py-2 text-xs" disabled={disabled || selectedIds.size === 0} onClick={onDeselectAll}>Deselect All</Button></div>
    </div>
    <p id={`${fieldId}-hint`} className="text-xs leading-5 text-slate-500">Select All Eligible includes the full organization list, including names outside this search. Maximum {maximumBulkParticipants.toLocaleString()} participants per batch.</p>
    <fieldset disabled={disabled} aria-describedby={`${fieldId}-count ${fieldId}-hint`} className="min-w-0 rounded-xl border border-slate-200 bg-white disabled:opacity-60">
      <legend className="sr-only">Eligible participants to register</legend>
      {filtered.length ? <div className="max-h-72 overflow-y-auto overscroll-contain p-2"><ul className="divide-y divide-slate-100">{filtered.map(participant => <li key={participant.id}><label className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3 hover:bg-teal-50/50"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-teal-700" checked={selectedIds.has(participant.id)} onChange={() => onToggle(participant.id)} /><span className="min-w-0 break-words text-sm font-medium leading-5 text-slate-800">{participant.full_name}</span></label></li>)}</ul></div> : <p className="px-4 py-7 text-center text-sm text-slate-500">No eligible participants match this search.</p>}
    </fieldset>
    {search && <p className="text-xs text-slate-400">Showing {filtered.length.toLocaleString()} of {participants.length.toLocaleString()} eligible participants. Hidden selections stay selected.</p>}
  </div>
}
