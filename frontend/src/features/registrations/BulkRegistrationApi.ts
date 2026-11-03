import { ApiError, apiRequest } from '../../services/api'
import type { BulkRegistrationRequest, BulkRegistrationResult } from './types'

export async function createBulkRegistration(payload: BulkRegistrationRequest) {
  const result = await apiRequest<BulkRegistrationResult>('/api/v1/registrations/bulk', { method: 'POST', body: payload })
  const receivedIds = new Set(Array.isArray(result.registrations) ? result.registrations.map(row => row.participant_id) : [])
  if (result.event_id !== payload.event_id || result.idempotency_key !== payload.idempotency_key
    || typeof result.operation_id !== 'string' || !result.operation_id || typeof result.replayed !== 'boolean'
    || result.created_count !== payload.participant_ids.length || !Array.isArray(result.registrations)
    || result.registrations.length !== payload.participant_ids.length || receivedIds.size !== payload.participant_ids.length
    || result.registrations.some(row => row.event_id !== payload.event_id || row.fee_required !== payload.fee_required)
    || payload.participant_ids.some(id => !receivedIds.has(id))) {
    throw new ApiError('The server did not return a matching registration receipt. Retry the same batch to confirm its outcome safely.', 502)
  }
  return result
}
