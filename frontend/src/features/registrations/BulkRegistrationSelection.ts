import type { Participant } from '../participants/types'
import type { BulkRegistrationRequest } from './types'

export const maximumBulkParticipants = 1000

export class BulkRegistrationValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'BulkRegistrationValidationError' }
}

export function bulkRemainingPlaces(capacity: number | null, registeredCount: number) {
  return capacity === null ? null : Math.max(0, capacity - registeredCount)
}

export function bulkSelectionProblem(participantIds: readonly string[], eligibleIds: ReadonlySet<string>, remaining: number | null): string | null {
  if (!participantIds.length) return 'Select at least one eligible participant.'
  if (participantIds.length > maximumBulkParticipants) return `A batch can contain up to ${maximumBulkParticipants.toLocaleString()} participants. Reduce your selection before continuing.`
  if (new Set(participantIds).size !== participantIds.length) return 'Each participant can appear only once in a batch.'
  if (participantIds.some(id => !eligibleIds.has(id))) return 'Some selected participants are no longer eligible. Refresh the list and select the available participants.'
  if (remaining !== null && participantIds.length > remaining) return `Only ${remaining.toLocaleString()} ${remaining === 1 ? 'place remains' : 'places remain'}. Select fewer participants before continuing.`
  return null
}

export function bulkRequestFingerprint(request: Pick<BulkRegistrationRequest, 'event_id' | 'participant_ids' | 'fee_required'>) {
  return JSON.stringify([request.event_id, [...request.participant_ids].sort(), request.fee_required])
}

export function prepareBulkRequest(
  eventId: string,
  participantIds: readonly string[],
  feeRequired: boolean,
  previous: BulkRegistrationRequest | null,
  createKey: () => string = () => crypto.randomUUID(),
): BulkRegistrationRequest {
  const payload = { event_id: eventId, participant_ids: [...participantIds].sort(), fee_required: feeRequired }
  return {
    ...payload,
    idempotency_key: previous && bulkRequestFingerprint(previous) === bulkRequestFingerprint(payload)
      ? previous.idempotency_key : createKey(),
  }
}

export function filterBulkParticipants(participants: Participant[], search: string) {
  const normalized = search.trim().toLocaleLowerCase()
  return normalized ? participants.filter(participant => participant.full_name.toLocaleLowerCase().includes(normalized)) : participants
}

export function bulkOutcomeIsUncertain(error: unknown) {
  if (error instanceof BulkRegistrationValidationError) return false
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
  return typeof status !== 'number' || status >= 500 || status === 408 || status === 0
}

export interface BulkRegistrationIssue { message: string; participantId?: string; index?: number }

export function bulkRegistrationIssues(detail: unknown): BulkRegistrationIssue[] {
  if (!Array.isArray(detail)) return []
  return detail.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== 'object' || !('msg' in issue) || typeof issue.msg !== 'string') return []
    const participantId = 'participant_id' in issue && typeof issue.participant_id === 'string' ? issue.participant_id : undefined
    const loc = 'loc' in issue && Array.isArray(issue.loc) ? issue.loc : []
    const index = loc.findLast((part: unknown) => typeof part === 'number')
    return [{ message: issue.msg, participantId, index: typeof index === 'number' ? index : undefined }]
  })
}
