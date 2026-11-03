import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button, ErrorState } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { apiRequest } from '../../services/api'
import type { EventRecord } from '../../types/api'
import { useOrganization } from '../organizations/useOrganization'
import { formatEventDate } from './format'

interface Props {
  value: string
  onChange: (event: EventRecord | null) => void
  label?: string
  selectedEvent?: EventRecord | null
}

export default function EventPicker({ value, onChange, label = 'Select an event', selectedEvent }: Props) {
  const { organization } = useOrganization()
  const [search, setSearch] = useState('')
  const query = useInfiniteQuery({
    queryKey: ['events', organization?.id, 'picker', search],
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ organization_id: organization!.id, page: String(pageParam), page_size: '50' })
      if (search) params.set('search', search)
      return apiRequest<EventRecord[]>(`/api/v1/events?${params}`, { signal })
    },
    getNextPageParam: (last, pages) => last.length === 50 ? pages.length + 1 : undefined,
    enabled: Boolean(organization),
  })
  const events = query.data?.pages.flat().filter(event => event.organization_id === organization?.id) ?? []
  if (selectedEvent?.organization_id === organization?.id && selectedEvent?.id === value && !events.some(event => event.id === value)) events.unshift(selectedEvent)

  return <div className="space-y-3">
    <form className="flex items-end gap-2" role="search" aria-label="Find events" onSubmit={event => {
      event.preventDefault()
      setSearch(String(new FormData(event.currentTarget).get('event-search') ?? '').trim())
      onChange(null)
    }}>
      <div className="min-w-0 flex-1"><label htmlFor="picker-search" className="mb-2 block text-sm font-semibold text-slate-700">Find an event</label><input id="picker-search" name="event-search" type="search" maxLength={100} placeholder="Search by event name" className={inputClassName} /></div>
      <Button variant="secondary" type="submit"><Search className="size-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">Search</span></Button>
    </form>
    {query.isError ? <ErrorState error={query.error} onRetry={() => { void query.refetch() }} /> : <>
      <label htmlFor="event-picker" className="block text-sm font-semibold text-slate-700">{label}</label>
      <select id="event-picker" value={value} disabled={query.isPending} className={inputClassName} onChange={event => onChange(events.find(item => item.id === event.target.value) ?? null)}>
        <option value="">{query.isPending ? 'Loading events…' : events.length ? 'Choose an event' : 'No matching events'}</option>
        {events.map(event => <option key={event.id} value={event.id}>{event.title} · {formatEventDate(event.start_at)}</option>)}
      </select>
      {query.hasNextPage && <Button variant="ghost" busy={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage() }}>Load more events</Button>}
    </>}
  </div>
}
