import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, ErrorState } from '../../../components/ui'
import ConfirmationDialog from '../../../components/ui/ConfirmationDialog'
import { inputClassName } from '../../../components/ui/styles'
import { useScopedMutation } from '../../../hooks/useScopedMutation'
import { ApiError, getErrorMessage } from '../../../services/api'
import type { EventRecord } from '../../../types/api'
import EventPicker from '../../events/EventPicker'
import { useEvent } from '../../events/queries'
import { useOrganization } from '../../organizations/useOrganization'
import { acceptsRegistrations } from '../../registrations/policies'
import { registrationKeys, useRegistrations } from '../../registrations/queries'
import { participantKeys } from '../queries'
import { applyParticipantImport, previewParticipantImport } from './api'
import ImportPreviewTable from './ImportPreviewTable'
import { canSelectImportRow, importSelectionIdentity, readImportIssues, selectedImportRows, validateImportFile } from './policies'
import type { ParticipantImportPreview, ParticipantImportRequest, ParticipantImportResult, ParticipantImportSelection } from './types'

interface PreviewVariables { file: File; organizationId: string; sequence: number; signal: AbortSignal }
interface Attempt { identity: string; request: ParticipantImportRequest }

export default function ParticipantImportPanel({ onClose, onImported }: {
  onClose: () => void
  onImported?: (result: ParticipantImportResult) => void
}) {
  const { organization, canManageEvents } = useOrganization()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const previewController = useRef<AbortController | null>(null)
  const previewSequence = useRef(0)
  const attempt = useRef<Attempt | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<unknown>(null)
  const [preview, setPreview] = useState<ParticipantImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [skipInvalid, setSkipInvalid] = useState(false)
  const [addToEvent, setAddToEvent] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null)
  const [feeRequired, setFeeRequired] = useState(false)
  const [confirmation, setConfirmation] = useState<ParticipantImportRequest | null>(null)
  const [uncertainRequest, setUncertainRequest] = useState<ParticipantImportRequest | null>(null)
  const [result, setResult] = useState<ParticipantImportResult | null>(null)
  const eventQuery = useEvent(organization?.id, selectedEvent?.id ?? '', addToEvent && Boolean(selectedEvent))
  const event = eventQuery.isSuccess ? eventQuery.data : null
  const registrations = useRegistrations(addToEvent ? organization?.id : undefined, addToEvent && event ? event.id : undefined)

  useEffect(() => () => {
    previewSequence.current += 1
    previewController.current?.abort()
  }, [])

  const previewMutation = useScopedMutation<ParticipantImportPreview, PreviewVariables>({
    mutationFn: variables => {
      if (!canManageEvents || variables.organizationId !== organization?.id) throw new Error('An active Owner or Admin can preview imports for this organization.')
      return previewParticipantImport(variables.organizationId, variables.file, variables.signal)
    },
    onSuccess: (response, variables) => {
      if (variables.sequence !== previewSequence.current) return
      setPreview(response)
      setSelected(new Set(response.rows.filter(canSelectImportRow).map(row => row.row_number)))
      setPreviewError(null)
      setSkipInvalid(false)
    },
    onError: (error, variables) => {
      if (variables.sequence === previewSequence.current) setPreviewError(error)
    },
  })
  const apply = useScopedMutation<ParticipantImportResult, ParticipantImportRequest>({
    mutationFn: request => {
      if (!canManageEvents || request.organization_id !== organization?.id) throw new Error('An active Owner or Admin can import into this organization.')
      return applyParticipantImport(request)
    },
    onSuccess: async (response, request) => {
      setResult(response)
      setConfirmation(null)
      setUncertainRequest(null)
      onImported?.(response)
      await queryClient.invalidateQueries({ queryKey: participantKeys.organization(request.organization_id) })
      if (request.event_id) await queryClient.invalidateQueries({ queryKey: registrationKeys.event(request.organization_id, request.event_id) })
    },
    onError: (error, request) => {
      setConfirmation(null)
      if (!(error instanceof ApiError) || error.status >= 500) setUncertainRequest(request)
      else setUncertainRequest(null)
    },
  })

  if (!organization || !canManageEvents) return null
  const chosenRows = preview ? selectedImportRows(preview.rows, selected) : []
  const invalidCount = preview?.rows.filter(row => !canSelectImportRow(row)).length ?? 0
  const excludedCount = (preview?.total_rows ?? 0) - chosenRows.length
  const registeredCount = registrations.isSuccess ? registrations.data.filter(row => row.status === 'registered').length : null
  const remainingCapacity = event?.capacity === null || !event || registeredCount === null ? null : Math.max(0, event.capacity - registeredCount)
  const capacityExceeded = addToEvent && remainingCapacity !== null && chosenRows.length > remainingCapacity
  const eventReady = !addToEvent || Boolean(selectedEvent && event && !eventQuery.error && registrations.isSuccess && !registrations.error && acceptsRegistrations(event))
  const payloadFrozen = apply.isPending || Boolean(uncertainRequest) || Boolean(result)
  const canReview = Boolean(preview && chosenRows.length && (!invalidCount || skipInvalid) && eventReady && !capacityExceeded && !payloadFrozen)
  const applyIssues = readImportIssues(apply.error instanceof ApiError ? apply.error.detail : undefined, apply.variables?.rows ?? [])

  function resetAttempt() {
    attempt.current = null
    setConfirmation(null)
    apply.reset()
  }

  function selectFile(next: File | null) {
    previewSequence.current += 1
    previewController.current?.abort()
    setFile(next)
    setFileError(next ? validateImportFile(next) : null)
    setPreviewError(null)
    setPreview(null)
    setSelected(new Set())
    setSkipInvalid(false)
    setAddToEvent(false)
    setSelectedEvent(null)
    setFeeRequired(false)
    setResult(null)
    setUncertainRequest(null)
    previewMutation.reset()
    resetAttempt()
  }

  function runPreview() {
    if (!file || !organization || payloadFrozen || validateImportFile(file)) return
    previewSequence.current += 1
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    setPreviewError(null)
    setPreview(null)
    setSelected(new Set())
    setSkipInvalid(false)
    resetAttempt()
    previewMutation.mutate({ file, organizationId: organization.id, sequence: previewSequence.current, signal: controller.signal })
  }

  function reviewImport() {
    if (!organization || !canReview) return
    const selection: ParticipantImportSelection = {
      organization_id: organization.id, rows: chosenRows,
      event_id: addToEvent ? event?.id ?? null : null,
      fee_required: addToEvent && feeRequired,
    }
    const identity = importSelectionIdentity(selection)
    if (attempt.current?.identity !== identity) attempt.current = { identity, request: { ...selection, idempotency_key: crypto.randomUUID() } }
    setConfirmation(attempt.current.request)
  }

  function changeSelection(next: Set<number>) {
    setSelected(next)
    resetAttempt()
  }

  return <Card className="overflow-hidden">
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 sm:p-6"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileSpreadsheet size={21} className="text-teal-700" aria-hidden="true" />Import participants</h2><p className="mt-2 text-sm leading-6 text-slate-500">Upload a spreadsheet, review the server’s validation, then choose exactly which new participants to save.</p></div><Button variant="ghost" className="shrink-0 px-2" aria-label="Close participant import" disabled={apply.isPending || Boolean(uncertainRequest)} onClick={onClose}><X size={18} aria-hidden="true" /></Button></div>
    <div className="space-y-6 p-5 sm:p-6">
      {result ? <div role="status" className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-5 text-teal-900"><h3 className="flex items-center gap-2 font-semibold"><CheckCircle2 size={20} aria-hidden="true" />Import {result.replayed ? 'confirmed' : 'complete'}</h3><p className="text-sm leading-6">{result.created_count} {result.created_count === 1 ? 'participant was' : 'participants were'} created{result.registered_count ? ` and ${result.registered_count} registered for the selected event` : ''}.</p>{result.replayed && <p className="text-xs leading-6">The original saved result was returned. Retrying did not create another copy.</p>}<p className="break-all text-xs leading-5">Import reference: {result.operation_id}</p><div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={apply.isPending} onClick={() => { selectFile(null); if (fileInput.current) fileInput.current.value = '' }}>Import another file</Button>{result.event_id && <Link to={`/events/${result.event_id}#event-registrations`} className="self-center text-sm font-semibold underline">View event registrations</Link>}<Button variant="ghost" disabled={apply.isPending} onClick={onClose}>Done</Button></div></div> : <>
        <div className="flex flex-col justify-between gap-4 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-start"><div><h3 className="text-sm font-semibold text-slate-800">Start with the import template</h3><p className="mt-1 max-w-xl text-xs leading-6 text-slate-500">The first row must contain the <code>full_name</code> header. Use CSV or XLSX, up to 5 MiB and 1,000 data rows. Preview never saves data.</p></div><a href="/participant-import-template.csv" download className="inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"><Download size={16} aria-hidden="true" />Download CSV template</a></div>
        <div className="space-y-3"><label htmlFor="participant-import-file" className="block text-sm font-semibold text-slate-700">CSV or XLSX file</label><input ref={fileInput} id="participant-import-file" type="file" accept=".csv,.xlsx" disabled={payloadFrozen} onChange={event => selectFile(event.target.files?.[0] ?? null)} className={`${inputClassName} file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-teal-800`} aria-invalid={Boolean(fileError)} aria-describedby={fileError ? 'participant-import-file-error' : 'participant-import-file-hint'} /><p id="participant-import-file-hint" className="text-xs leading-5 text-slate-500">Files are parsed by the server. Existing names and duplicates are flagged for review.</p>{fileError && <p id="participant-import-file-error" role="alert" className="text-sm text-red-700">{fileError}</p>}<Button onClick={runPreview} busy={previewMutation.isPending} disabled={!file || Boolean(fileError) || payloadFrozen}><Upload size={16} aria-hidden="true" />{previewMutation.isPending ? 'Validating file…' : 'Preview import'}</Button></div>
        {previewError != null && <ErrorState title="Unable to preview this file" error={previewError} onRetry={file && !fileError ? runPreview : undefined} />}
        {apply.isError && <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"><p className="font-semibold">The import has not been confirmed</p><p>{getErrorMessage(apply.error)}</p>{applyIssues.length > 0 && <ul className="list-inside list-disc">{applyIssues.map((issue, index) => <li key={index}>{issue.row_number !== null ? `Row ${issue.row_number}: ` : ''}{issue.message}</li>)}</ul>}</div>}
        {uncertainRequest && <div role="status" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p className="flex items-start gap-2 font-semibold"><AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />The server may already have saved this import.</p><p>Your {uncertainRequest.rows.length} selected rows, event choice, and import reference are frozen. Retry the unchanged request to safely retrieve or finish the same operation.</p><p>Keep this screen open to retain the retry reference. If you leave, refresh the directory before starting another import.</p><p className="break-all text-xs">Retry reference: {uncertainRequest.idempotency_key}</p><Button variant="secondary" onClick={() => setConfirmation(uncertainRequest)} busy={apply.isPending}>Retry unchanged import</Button></div>}
        {preview && <div className="space-y-5">
          <div><h3 className="font-semibold text-slate-900">Server preview</h3><p className="mt-1 break-words text-xs leading-6 text-slate-500">{preview.filename} · {preview.total_rows} rows · {preview.valid_rows} valid · {preview.invalid_rows} invalid or duplicate</p></div>
          {preview.total_rows === 0 && <p role="alert" className="text-sm leading-6 text-amber-900">The file has no participant rows. Add names below the full_name header, then upload it again.</p>}
          <ImportPreviewTable rows={preview.rows} selected={selected} disabled={payloadFrozen} onToggle={rowNumber => { const next = new Set(selected); if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber); changeSelection(next) }} onSelectAll={() => changeSelection(new Set(preview.rows.filter(canSelectImportRow).map(row => row.row_number)))} onClear={() => changeSelection(new Set())} />
          {invalidCount > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="mb-3 text-xs leading-6 text-amber-900">Names that already exist or repeat within the file are not imported. Two people can share a name; review possible duplicates before adding anyone manually.</p><label className="flex items-start gap-2.5 text-sm leading-6 text-amber-900"><input type="checkbox" checked={skipInvalid} onChange={event => setSkipInvalid(event.target.checked)} disabled={payloadFrozen} className="mt-1 size-4 shrink-0 accent-teal-700" /><span>Skip the {invalidCount} invalid or duplicate {invalidCount === 1 ? 'row' : 'rows'} shown above.</span></label></div>}
          <fieldset disabled={payloadFrozen} className="space-y-5 rounded-xl border border-slate-200 p-4 disabled:opacity-70"><legend className="px-2 text-sm font-semibold text-slate-700">Optional event registration</legend><label className="flex items-start gap-2.5 text-sm leading-6 text-slate-700"><input type="checkbox" checked={addToEvent} onChange={event => { setAddToEvent(event.target.checked); if (!event.target.checked) { setSelectedEvent(null); setFeeRequired(false) } resetAttempt() }} className="mt-1 size-4 shrink-0 accent-teal-700" /><span>Also register the imported participants for an event.</span></label>{addToEvent && <>
            <EventPicker value={selectedEvent?.id ?? ''} selectedEvent={selectedEvent} onChange={next => { if (next?.id !== selectedEvent?.id) resetAttempt(); setSelectedEvent(next) }} label="Import registration event" />
            {eventQuery.isError && <ErrorState title="Unable to verify this event" error={eventQuery.error} onRetry={() => void eventQuery.refetch()} />}
            {selectedEvent && eventQuery.isPending && <p role="status" className="text-sm text-slate-500">Checking event details…</p>}
            {event && <div className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600"><p className="break-words font-semibold text-slate-800">{event.title}</p><p>Status: {event.status}. {registrations.isPending ? 'Checking registration capacity…' : registrations.isError ? 'Capacity is unavailable until verification succeeds.' : event.capacity === null ? `${registeredCount} currently registered · no capacity limit.` : `${registeredCount} currently registered · capacity ${event.capacity} · ${remainingCapacity} spaces remain.`}</p>{!acceptsRegistrations(event) && <p className="mt-1 font-medium text-red-700">Choose a Planned or Active event that accepts registrations.</p>}{capacityExceeded && <p role="alert" className="mt-1 font-medium text-red-700">The {chosenRows.length} selected participants exceed the remaining capacity. Select fewer rows or choose another event.</p>}<p className="mt-1">The server rechecks event permissions and capacity when saving.</p></div>}
            {registrations.isError && <ErrorState title="Unable to verify event capacity" error={registrations.error} onRetry={() => void registrations.refetch()} />}
            <label className="flex items-start gap-2.5 text-sm leading-6 text-slate-600"><input type="checkbox" checked={feeRequired} onChange={event => { setFeeRequired(event.target.checked); resetAttempt() }} className="mt-1 size-4 shrink-0 accent-teal-700" /><span>Fee required for these registrations<span className="block text-xs text-slate-500">Records a requirement only; no payment is collected or changed here.</span></span></label>
          </>}</fieldset>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5"><p className="text-sm leading-6 text-slate-600"><span className="font-semibold text-slate-900">{chosenRows.length}</span> selected · {excludedCount} excluded. Nothing is saved until you confirm.</p><Button disabled={!canReview} onClick={reviewImport}>Review and import</Button></div>
        </div>}
      </>}
    </div>
    <ConfirmationDialog open={Boolean(confirmation)} title={uncertainRequest ? 'Retry the unchanged import?' : 'Confirm participant import'} description="The server revalidates the selected rows and saves the complete batch atomically." confirmLabel={uncertainRequest ? 'Retry unchanged import' : 'Import selected participants'} busy={apply.isPending} onCancel={() => { if (!apply.isPending) setConfirmation(null) }} onConfirm={() => { if (confirmation) apply.mutate(confirmation) }}>
      {confirmation && <div className="space-y-3 text-sm leading-6 text-slate-600"><p>Create <strong className="text-slate-900">{confirmation.rows.length} new {confirmation.rows.length === 1 ? 'participant' : 'participants'}</strong> in <strong className="text-slate-900">{organization.name}</strong>.</p>{confirmation.event_id ? <p>Register all selected participants for <strong className="break-words text-slate-900">{event?.title ?? selectedEvent?.title ?? 'the selected event'}</strong>. {event?.capacity === null ? 'The event has no capacity limit.' : remainingCapacity !== null ? `${remainingCapacity} spaces are currently available.` : 'Capacity is rechecked by the server.'} {confirmation.fee_required ? 'A fee requirement will be recorded.' : 'No fee requirement will be recorded.'}</p> : <p>No event registrations will be created.</p>}<p>{excludedCount} file rows are excluded. If validation, permissions, duplicates, or capacity conflict, the batch is rejected without a partial import.</p><p className="break-all text-xs text-slate-400">Import reference: {confirmation.idempotency_key}</p></div>}
    </ConfirmationDialog>
  </Card>
}
