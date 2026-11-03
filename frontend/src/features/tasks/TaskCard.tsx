import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, StatusBadge } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { getErrorMessage } from '../../services/api'
import type { Membership } from '../../types/api'
import { useAuth } from '../auth/useAuth'
import { formatEventDate } from '../events/format'
import { useOrganization } from '../organizations/useOrganization'
import { updateTaskStatus } from './api'
import { taskKeys, useTaskAssignments } from './queries'
import TaskAssignments from './TaskAssignments'
import TaskForm from './TaskForm'
import { canChangeTaskStatus, taskLabel, taskStatuses } from './types'
import type { TaskRecord, TaskStatus } from './types'

export default function TaskCard({ task, members }: { task: TaskRecord; members: Membership[] }) {
  const { user } = useAuth()
  const { organization, membership, canManageEvents } = useOrganization()
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const assignmentsQuery = useTaskAssignments(organization!.id, task.event_id, task.id)
  const queryClient = useQueryClient()
  const canUpdateStatus = canChangeTaskStatus(membership?.role, user?.id, assignmentsQuery.isSuccess ? assignmentsQuery.data : [])
  const statusMutation = useScopedMutation<TaskRecord, TaskStatus>({
    mutationFn: status => {
      if (!canUpdateStatus) throw new Error('You do not have permission to update this task’s status.')
      return updateTaskStatus(task.id, status)
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: taskKeys.event(organization!.id, task.event_id) }); setNotice('Task status updated.') },
  })
  const priorityColors = { low: 'bg-slate-100 text-slate-600', medium: 'bg-amber-50 text-amber-800', high: 'bg-rose-50 text-rose-700' }

  return <Card className="min-w-0 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2"><StatusBadge status={task.status} /><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${priorityColors[task.priority]}`}>{taskLabel(task.priority)} priority</span></div><h3 className="break-words font-semibold text-slate-900">{task.title}</h3></div>
      {canManageEvents && !editing && <Button variant="ghost" aria-label={`Edit ${task.title}`} onClick={() => { setNotice(''); setEditing(true) }} className="shrink-0 px-2"><Pencil size={16} aria-hidden="true" /></Button>}
    </div>
    {notice && <p role="status" className="mt-4 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-900">{notice}</p>}
    {editing ? <div className="mt-5"><TaskForm task={task} eventId={task.event_id} onSaved={message => { setEditing(false); setNotice(message) }} onCancel={() => setEditing(false)} /></div> : <>
      {task.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{task.description}</p>}
      <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-slate-500"><CalendarClock size={15} className="mt-1 shrink-0" aria-hidden="true" />{task.due_at ? <span>Due <time dateTime={task.due_at}>{formatEventDate(task.due_at)}</time></span> : 'No due date'}</p>
      {canUpdateStatus ? <div className="mt-4">
        <label htmlFor={`task-status-${task.id}`} className="mb-1.5 block text-xs font-semibold text-slate-600">Update status</label>
        <select id={`task-status-${task.id}`} className={inputClassName} value={task.status} disabled={statusMutation.isPending} aria-busy={statusMutation.isPending} onChange={event => statusMutation.mutate(event.target.value as TaskStatus)}>
          {taskStatuses.map(status => <option key={status} value={status}>{taskLabel(status)}</option>)}
        </select>
      </div> : <p className="mt-4 text-xs leading-5 text-slate-400">{membership?.role === 'Viewer' ? 'Your Viewer role has read-only task access.' : 'Assigned members, Owners, and Admins can update task status.'}</p>}
      {statusMutation.isError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(statusMutation.error)}</p>}
    </>}
    <TaskAssignments task={task} members={members} query={assignmentsQuery} onNotice={setNotice} />
  </Card>
}
