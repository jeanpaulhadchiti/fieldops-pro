import { z } from 'zod'
import { apiRequest } from '../../../services/api'
import type { ParticipantImportPreview, ParticipantImportRequest, ParticipantImportResult } from './types'
import { maximumImportRows } from './policies'

const previewRowSchema = z.object({
  row_number: z.number().int().min(2),
  full_name: z.string(),
  errors: z.array(z.string()),
  duplicate_of_row: z.number().int().min(2).nullable(),
  existing_participant_id: z.uuid().nullable(),
})

const previewSchema = z.object({
  organization_id: z.uuid(),
  filename: z.string(),
  rows: z.array(previewRowSchema).max(maximumImportRows),
  total_rows: z.number().int().min(0).max(maximumImportRows),
  valid_rows: z.number().int().min(0).max(maximumImportRows),
  invalid_rows: z.number().int().min(0).max(maximumImportRows),
}).refine(result => result.total_rows === result.rows.length && result.valid_rows + result.invalid_rows === result.total_rows
  && new Set(result.rows.map(row => row.row_number)).size === result.rows.length)

const participantSchema = z.object({ id: z.uuid(), organization_id: z.uuid(), full_name: z.string(), created_at: z.string() })
const registrationSchema = z.object({
  id: z.uuid(), event_id: z.uuid(), participant_id: z.uuid(), status: z.enum(['registered', 'cancelled']),
  attended_at: z.string().nullable(), fee_required: z.boolean(), payment_status: z.enum(['unpaid', 'partial', 'paid']).nullable(), created_at: z.string(),
})
const resultSchema = z.object({
  operation_id: z.uuid(), idempotency_key: z.uuid(), organization_id: z.uuid(), event_id: z.uuid().nullable(),
  participants: z.array(participantSchema), registrations: z.array(registrationSchema),
  created_count: z.number().int().nonnegative(), registered_count: z.number().int().nonnegative(), replayed: z.boolean(),
})

export async function previewParticipantImport(organizationId: string, file: File, signal: AbortSignal): Promise<ParticipantImportPreview> {
  const form = new FormData()
  form.set('organization_id', organizationId)
  form.set('file', file)
  const response = await apiRequest<unknown>('/api/v1/participants/import/preview', { method: 'POST', body: form, signal })
  const parsed = previewSchema.safeParse(response)
  if (!parsed.success || parsed.data.organization_id !== organizationId) throw new Error('The import preview could not be verified for this organization. Please upload the file again.')
  return parsed.data
}

export async function applyParticipantImport(request: ParticipantImportRequest): Promise<ParticipantImportResult> {
  const response = await apiRequest<unknown>('/api/v1/participants/import', { method: 'POST', body: request })
  const parsed = resultSchema.safeParse(response)
  if (!parsed.success || parsed.data.organization_id !== request.organization_id || parsed.data.idempotency_key !== request.idempotency_key
    || parsed.data.event_id !== request.event_id || parsed.data.created_count !== request.rows.length || parsed.data.created_count !== parsed.data.participants.length
    || parsed.data.registered_count !== parsed.data.registrations.length
    || parsed.data.registered_count !== (request.event_id ? request.rows.length : 0)
    || parsed.data.participants.some(participant => participant.organization_id !== request.organization_id)
    || parsed.data.registrations.some(registration => registration.event_id !== request.event_id || !parsed.data.participants.some(participant => participant.id === registration.participant_id))) {
    throw new Error('The import response could not be verified. Retry the unchanged import with its existing reference to confirm the result safely.')
  }
  return parsed.data
}
