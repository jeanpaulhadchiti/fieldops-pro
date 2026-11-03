import { CheckCircle2, CircleAlert } from 'lucide-react'
import { Button } from '../../../components/ui'
import { canSelectImportRow, importRowIssues } from './policies'
import type { ParticipantImportRow } from './types'

export default function ImportPreviewTable({ rows, selected, onToggle, onSelectAll, onClear, disabled }: {
  rows: ParticipantImportRow[]
  selected: ReadonlySet<number>
  onToggle: (rowNumber: number) => void
  onSelectAll: () => void
  onClear: () => void
  disabled: boolean
}) {
  return <div className="overflow-hidden rounded-xl border border-slate-200">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3"><p className="text-xs leading-5 text-slate-500">Only valid, new participant rows can be selected.</p><div className="flex gap-2"><Button variant="ghost" className="px-2 py-1 text-xs" onClick={onSelectAll} disabled={disabled}>Select all valid</Button><Button variant="ghost" className="px-2 py-1 text-xs" onClick={onClear} disabled={disabled}>Clear selection</Button></div></div>
    <div className="max-h-[28rem] overflow-auto" tabIndex={0} role="region" aria-label="Import preview rows">
      <table className="w-full text-left text-sm"><caption className="sr-only">Server-validated participant import preview, including invalid rows and duplicates.</caption><thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-3 font-semibold"><span className="sr-only">Select</span></th><th className="px-3 py-3 font-semibold">Row</th><th className="px-3 py-3 font-semibold">Full name</th><th className="px-3 py-3 font-semibold">Validation</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">
        {rows.map(row => {
          const issues = importRowIssues(row)
          const valid = canSelectImportRow(row)
          return <tr key={row.row_number} className={!valid ? 'bg-amber-50/40' : ''}><td className="px-3 py-3 align-top"><input type="checkbox" checked={valid && selected.has(row.row_number)} disabled={!valid || disabled} onChange={() => onToggle(row.row_number)} aria-label={`Select row ${row.row_number}${row.full_name ? `: ${row.full_name}` : ''}`} className="mt-0.5 size-4 accent-teal-700" /></td><th scope="row" className="px-3 py-3 align-top text-xs font-medium text-slate-500">{row.row_number}</th><td className="max-w-64 min-w-32 break-words px-3 py-3 align-top text-slate-800">{row.full_name || <span className="italic text-slate-400">No name supplied</span>}</td><td className="min-w-48 px-3 py-3 align-top">{valid ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700"><CheckCircle2 size={14} aria-hidden="true" />Ready to import</span> : <div className="flex items-start gap-1.5 text-xs leading-5 text-amber-900"><CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><div><ul className="list-inside list-disc space-y-1">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>{row.duplicate_of_row !== null && <p className="mt-1 text-amber-700">Duplicate within file · first seen on row {row.duplicate_of_row}.</p>}{row.existing_participant_id && <p className="mt-1 text-amber-700">Already exists in the selected organization.</p>}</div></div>}</td></tr>
        })}
      </tbody></table>
    </div>
  </div>
}
