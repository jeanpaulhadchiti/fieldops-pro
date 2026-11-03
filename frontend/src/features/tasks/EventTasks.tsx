import { ListTodo, Plus, RefreshCw, Search } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import type { EventRecord } from '../../types/api'
import { localTimeZone } from '../events/format'
import { useOrganization } from '../organizations/useOrganization'
import { useTaskMembers, useTasks } from './queries'
import TaskCard from './TaskCard'
import TaskForm from './TaskForm'
import { taskLabel, taskPriorities, taskStatuses } from './types'

export default function EventTasks({ event }: { event: EventRecord }) {
  const { organization, canManageEvents } = useOrganization()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const fieldId = useId()
  const correctScope = organization?.id === event.organization_id
  const tasksQuery = useTasks(organization?.id ?? '', event.id, correctScope)
  const membersQuery = useTaskMembers()
  const tasks = tasksQuery.data ?? []
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredTasks = tasks.filter(task => (!status || task.status === status)
    && (!priority || task.priority === priority)
    && (!normalizedSearch || `${task.title} ${task.description ?? ''}`.toLocaleLowerCase().includes(normalizedSearch)))
  const error = tasksQuery.error ?? membersQuery.error
  const loading = tasksQuery.isPending || membersQuery.isPending
  const refresh = () => {
    void tasksQuery.refetch()
    void membersQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: ['task-assignments', organization?.id, event.id] })
  }

  if (!correctScope) return <ErrorState title="Event unavailable" error={new Error('Select an event from the current organization to view its tasks.')} />

  return <section id="tasks" aria-labelledby={`${fieldId}-heading`} className="scroll-mt-24 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id={`${fieldId}-heading`} className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900"><ListTodo size={21} className="text-teal-700" aria-hidden="true" />Event tasks</h2><p className="mt-1 text-sm leading-6 text-slate-500">Coordinate work, track progress, and assign your team.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={tasksQuery.isFetching || membersQuery.isFetching} aria-label="Refresh tasks and assignments" onClick={refresh}><RefreshCw size={16} className={tasksQuery.isFetching ? 'animate-spin' : ''} aria-hidden="true" />Refresh</Button>{canManageEvents && !creating && <Button onClick={() => { setNotice(''); setCreating(true) }}><Plus size={16} aria-hidden="true" />Create task</Button>}</div>
    </div>
    {notice && <p role="status" className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">{notice}</p>}
    {creating && canManageEvents && <TaskForm eventId={event.id} onSaved={message => { setNotice(message); setCreating(false) }} onCancel={() => setCreating(false)} />}
    {!canManageEvents && <p className="text-xs leading-6 text-slate-500">Owners and Admins manage tasks and assignments. Other assigned members can update their task status, according to their role.</p>}
    <Card className="p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
        <div className="sm:col-span-2 lg:col-span-1"><label htmlFor={`${fieldId}-search`} className="mb-1.5 block text-xs font-semibold text-slate-600">Search tasks</label><div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" /><input id={`${fieldId}-search`} type="search" className={`${inputClassName} pl-9`} value={search} onChange={input => setSearch(input.target.value)} placeholder="Search names or descriptions…" /></div></div>
        <div><label htmlFor={`${fieldId}-status`} className="mb-1.5 block text-xs font-semibold text-slate-600">Status</label><select id={`${fieldId}-status`} className={inputClassName} value={status} onChange={input => setStatus(input.target.value)}><option value="">All statuses</option>{taskStatuses.map(value => <option key={value} value={value}>{taskLabel(value)}</option>)}</select></div>
        <div><label htmlFor={`${fieldId}-priority`} className="mb-1.5 block text-xs font-semibold text-slate-600">Priority</label><select id={`${fieldId}-priority`} className={inputClassName} value={priority} onChange={input => setPriority(input.target.value)}><option value="">All priorities</option>{taskPriorities.map(value => <option key={value} value={value}>{taskLabel(value)}</option>)}</select></div>
      </div>
      {tasksQuery.isSuccess && <p className="mt-4 text-xs text-slate-400" aria-live="polite">Showing {filteredTasks.length} of {tasks.length} tasks for this event · Dates in {localTimeZone}.</p>}
    </Card>
    {loading ? <LoadingState label="Loading event tasks and members…" /> : error ? <ErrorState title="Unable to load event tasks" error={error} onRetry={refresh} /> : filteredTasks.length ? <div className="grid items-start gap-5 xl:grid-cols-2">{filteredTasks.map(task => <TaskCard key={task.id} task={task} members={membersQuery.data ?? []} />)}</div> : <Card><EmptyState title={tasks.length ? 'No matching tasks' : 'A fresh task list'} description={tasks.length ? 'Try a different name, status, or priority.' : canManageEvents ? 'Create the first task, then assign active members to get work moving.' : 'Tasks will appear here when an Owner or Admin creates them.'} action={tasks.length ? <Button variant="secondary" onClick={() => { setSearch(''); setStatus(''); setPriority('') }}>Clear filters</Button> : canManageEvents && !creating ? <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />Create the first task</Button> : undefined} /></Card>}
  </section>
}
