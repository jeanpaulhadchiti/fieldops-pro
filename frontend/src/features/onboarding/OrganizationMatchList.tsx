import type { ReactNode } from 'react'
import { Building2, MapPin } from 'lucide-react'
import type { OrganizationMatch } from './types'
import { countryName } from '../../data/countries'

export default function OrganizationMatchList({ matches, action }: { matches: OrganizationMatch[]; action?: (match: OrganizationMatch) => ReactNode }) {
  return <ul className="space-y-3">{[...new Map(matches.map(match => [match.id, match])).values()].map(match => <li key={match.id} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><h3 className="break-words font-semibold text-slate-900">{match.name}</h3><p className="mt-2 flex items-center gap-2 text-xs leading-5 text-slate-500"><Building2 className="size-3.5 shrink-0" aria-hidden="true" />{match.organization_type === 'Other' ? match.organization_type_other || 'Other' : match.organization_type}</p><p className="mt-1 flex items-start gap-2 text-xs leading-5 text-slate-500"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{[match.city, countryName(match.country)].filter(Boolean).join(', ') || 'Location not provided'}</span></p><p className="mt-2 break-all text-[11px] leading-5 text-slate-500">Workspace reference: <span className="font-mono">{match.id}</span></p><p className="mt-2 text-[11px] font-medium text-teal-700">{match.match_kind === 'exact' ? 'Matching name' : 'Similar name'}</p></div>
    {action && <div className="shrink-0">{action(match)}</div>}
  </li>)}</ul>
}
