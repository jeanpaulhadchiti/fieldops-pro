import type { ParticipantImportIssue, ParticipantImportRow, ParticipantImportSelection } from './types'

export const maximumImportBytes = 5 * 1024 * 1024
export const maximumImportRows = 1000

export function validateImportFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) return 'Choose a CSV or XLSX file.'
  if (file.size === 0) return 'The selected file is empty.'
  if (file.size > maximumImportBytes) return 'Use a file no larger than 5 MiB.'
  return null
}

export function importRowIssues(row: ParticipantImportRow): string[] {
  const issues = [...row.errors]
  if (row.duplicate_of_row !== null && !issues.some(issue => /duplicate/i.test(issue))) issues.push(`Duplicate of row ${row.duplicate_of_row}.`)
  if (row.existing_participant_id && !issues.some(issue => /exist|directory/i.test(issue))) issues.push('This participant is already in the organization directory.')
  if (!row.full_name.trim() && !issues.length) issues.push('A full name is required.')
  if (row.full_name.length > 150 && !issues.length) issues.push('Full names must use 150 characters or fewer.')
  return issues
}

export const canSelectImportRow = (row: ParticipantImportRow) => importRowIssues(row).length === 0

export function selectedImportRows(rows: ParticipantImportRow[], selected: ReadonlySet<number>) {
  return rows.filter(row => selected.has(row.row_number) && canSelectImportRow(row))
    .sort((left, right) => left.row_number - right.row_number)
    .map(({ row_number, full_name }) => ({ row_number, full_name }))
}

/** Stable identity excludes the retry key; changing any submitted value starts a new operation. */
export function importSelectionIdentity(selection: ParticipantImportSelection) {
  return JSON.stringify({
    organization_id: selection.organization_id,
    rows: [...selection.rows].sort((left, right) => left.row_number - right.row_number),
    event_id: selection.event_id,
    fee_required: selection.fee_required,
  })
}

export function readImportIssues(detail: unknown, rows: ParticipantImportSelection['rows']): ParticipantImportIssue[] {
  if (!Array.isArray(detail)) return []
  return detail.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return []
    const issue = value as Record<string, unknown>
    if (typeof issue.msg !== 'string') return []
    const index = Array.isArray(issue.loc) && issue.loc[1] === 'rows' && typeof issue.loc[2] === 'number' ? issue.loc[2] : null
    const rowNumber = typeof issue.row_number === 'number' ? issue.row_number : index !== null ? rows[index]?.row_number ?? null : null
    return [{ row_number: rowNumber, message: issue.msg }]
  })
}
