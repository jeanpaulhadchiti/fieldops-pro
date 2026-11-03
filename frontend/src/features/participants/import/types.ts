import type { Participant } from '../types'
import type { Registration } from '../../registrations/types'

export interface ParticipantImportRow {
  row_number: number
  full_name: string
  errors: string[]
  duplicate_of_row: number | null
  existing_participant_id: string | null
}

export interface ParticipantImportPreview {
  organization_id: string
  filename: string
  rows: ParticipantImportRow[]
  total_rows: number
  valid_rows: number
  invalid_rows: number
}

export interface ParticipantImportSelection {
  organization_id: string
  rows: Array<{ row_number: number; full_name: string }>
  event_id: string | null
  fee_required: boolean
}

export interface ParticipantImportRequest extends ParticipantImportSelection {
  idempotency_key: string
}

export interface ParticipantImportResult {
  operation_id: string
  idempotency_key: string
  organization_id: string
  event_id: string | null
  participants: Participant[]
  registrations: Registration[]
  created_count: number
  registered_count: number
  replayed: boolean
}

export interface ParticipantImportIssue { row_number: number | null; message: string }
