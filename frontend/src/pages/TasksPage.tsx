import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '../components/ui'
import EventPicker from '../features/events/EventPicker'
import { useOrganization } from '../features/organizations/useOrganization'
import EventTasks from '../features/tasks/EventTasks'
import type { EventRecord } from '../types/api'

export default function TasksPage() {
  const { organization } = useOrganization()
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null)
  const scopedEvent = selectedEvent?.organization_id === organization?.id ? selectedEvent : null

  return <div className="space-y-7">
    <PageHeader eyebrow="Turn plans into action" title="Tasks" description={`Choose an event in ${organization?.name ?? 'your organization'} to manage its tasks and assignments.`} />
    <Card className="space-y-4 p-5 sm:p-6">
      <EventPicker value={scopedEvent?.id ?? ''} onChange={setSelectedEvent} label="Choose an event" />
      {scopedEvent && <Link to={`/events/${scopedEvent.id}#tasks`} className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-900">Open event details<ArrowUpRight size={15} aria-hidden="true" /></Link>}
    </Card>
    {scopedEvent ? <EventTasks key={scopedEvent.id} event={scopedEvent} /> : <Card><EmptyState title="Choose where the work happens" description="Select an existing event above to view its tasks, create work items, and assign organization members." /></Card>}
  </div>
}
