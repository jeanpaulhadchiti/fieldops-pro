/** Existing RegistrationRead / RegistrationCreate contracts. */
export interface Registration {
  id: string
  event_id: string
  participant_id: string
  status: 'registered' | 'cancelled'
  attended_at: string | null
  fee_required: boolean
  payment_status: 'unpaid' | 'partial' | 'paid' | null
  created_at: string
}

export interface RegistrationCreate {
  event_id: string
  participant_id: string
  fee_required?: boolean
}

/** Atomic, idempotent bulk registration contracts. */
export interface BulkRegistrationRequest {
  event_id: string
  participant_ids: string[]
  idempotency_key: string
  fee_required: boolean
}

export interface BulkRegistrationResult {
  operation_id: string
  idempotency_key: string
  event_id: string
  created_count: number
  registrations: Registration[]
  replayed: boolean
}
