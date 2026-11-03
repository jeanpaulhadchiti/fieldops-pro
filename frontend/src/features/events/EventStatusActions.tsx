import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { apiRequest, getErrorMessage } from '../../services/api'
import type { EventRecord } from '../../types/api'
import { useOrganization } from '../organizations/useOrganization'
import { eventKeys } from './queries'

const transitions: Record<string, { status: string; label: string }[]> = {
  planned: [{ status: 'active', label: 'Start event' }, { status: 'cancelled', label: 'Cancel event' }],
  active: [{ status: 'completed', label: 'Complete event' }, { status: 'cancelled', label: 'Cancel event' }],
}

export default function EventStatusActions({ event }: { event: EventRecord }) {
  const { organization, canManageEvents } = useOrganization()
  const client = useQueryClient()
  const [notice, setNotice] = useState('')
  const mutation = useScopedMutation<EventRecord, string>({
    mutationFn: status => {
      if (!canManageEvents || event.organization_id !== organization?.id || !transitions[event.status]?.some(item => item.status === status)) throw new Error('You cannot make this event status change.')
      return apiRequest<EventRecord>(`/api/v1/events/${event.id}/status`, { method: 'PATCH', body: { status } })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: eventKeys.organization(event.organization_id) })
      setNotice('Event status updated.')
    },
  })
  if (!canManageEvents || !transitions[event.status]?.length) return null

  return <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Event status</h2><p className="mt-1 text-xs leading-5 text-slate-500">Attendance is available while the event is active.</p></div><div className="flex flex-wrap gap-2">{transitions[event.status].map(({ status, label }) => <Button key={status} variant={status === 'cancelled' ? 'secondary' : 'primary'} disabled={mutation.isPending} onClick={() => {
      if (status !== 'active' && !window.confirm(`${label} “${event.title}”? This status change cannot be undone.`)) return
      setNotice('')
      mutation.mutate(status)
    }}>{label}</Button>)}</div></div>
    {mutation.isError && <p role="alert" className="text-sm text-red-700">{getErrorMessage(mutation.error)}</p>}
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
  </div>
}
