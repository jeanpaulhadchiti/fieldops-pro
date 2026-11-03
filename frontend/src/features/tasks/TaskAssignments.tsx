import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { UserPlus, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, ErrorState, Field, LoadingState } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { ApiError, getErrorMessage } from '../../services/api'
import type { Membership } from '../../types/api'
import { useOrganization } from '../organizations/useOrganization'
import { assignTask, removeTaskAssignment } from './api'
import { taskKeys } from './queries'
import type { useTaskAssignments } from './queries'
import { taskAssignmentSchema } from './schema'
import type { TaskAssignmentValues } from './schema'
import type { TaskAssignment, TaskRecord } from './types'

export default function TaskAssignments({ task, members, query, onNotice }: {
  task: TaskRecord
  members: Membership[]
  query: ReturnType<typeof useTaskAssignments>
  onNotice: (message: string) => void
}) {
  const { organization, canManageEvents } = useOrganization()
  const queryClient = useQueryClient()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<TaskAssignmentValues>({
    resolver: zodResolver(taskAssignmentSchema),
    defaultValues: { user_id: '' },
  })
  const refreshAssignments = () => queryClient.invalidateQueries({ queryKey: taskKeys.assignments(organization!.id, task.event_id, task.id) })
  const assignMutation = useScopedMutation<TaskAssignment, TaskAssignmentValues>({
    mutationFn: ({ user_id }) => {
      if (!canManageEvents) throw new Error('Only an Owner or Admin can assign tasks.')
      return assignTask(task.id, user_id)
    },
    onSuccess: async () => { await refreshAssignments(); reset(); onNotice('Member assigned to task.') },
    onError: async error => {
      if (error instanceof ApiError && error.status === 409) { reset(); await query.refetch() }
    },
  })
  const removeMutation = useScopedMutation<void, string>({
    mutationFn: (assignmentId) => {
      if (!canManageEvents) throw new Error('Only an Owner or Admin can remove task assignments.')
      return removeTaskAssignment(assignmentId)
    },
    onSuccess: async () => { await refreshAssignments(); setConfirmingId(null); onNotice('Task assignment removed.') },
  })
  const assignments = query.data ?? []
  const eligibleMembers = members.filter(member => member.status === 'active' && !assignments.some(assignment => assignment.user_id === member.user_id))
  const nameFor = (userId: string) => members.find(member => member.user_id === userId)?.name ?? `Member unavailable (${userId.slice(0, 8)})`
  const pending = assignMutation.isPending || removeMutation.isPending

  return <div className="mt-5 border-t border-slate-100 pt-5">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned members</h4>
    {query.isPending ? <LoadingState label="Loading assignments…" /> : query.isError ? <div className="mt-3"><ErrorState title="Unable to load assignments" error={query.error} onRetry={() => void query.refetch()} /></div> : <>
      {assignments.length === 0 ? <p className="mt-3 text-sm text-slate-500">No members assigned yet.</p> : <ul className="mt-3 space-y-2">
        {assignments.map(assignment => {
          const member = members.find(item => item.user_id === assignment.user_id)
          return <li key={assignment.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="break-words text-sm font-medium text-slate-800">{nameFor(assignment.user_id)}</p>{member && <p className="mt-0.5 break-words text-xs text-slate-500">{member.role}{member.status !== 'active' ? ` · ${member.status}` : ''}</p>}</div>
              {canManageEvents && <Button variant="ghost" disabled={pending} aria-label={`Remove ${nameFor(assignment.user_id)} from ${task.title}`} onClick={() => { removeMutation.reset(); setConfirmingId(assignment.id) }} className="shrink-0 px-2 text-slate-400 hover:text-red-700"><X size={15} aria-hidden="true" /></Button>}
            </div>
            {canManageEvents && confirmingId === assignment.id && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="group" aria-label="Confirm assignment removal">
              <p className="text-sm leading-6 text-amber-900">Remove {nameFor(assignment.user_id)} from this task?</p>
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="danger" busy={removeMutation.isPending} onClick={() => removeMutation.mutate(assignment.id)}>Remove assignment</Button><Button variant="secondary" disabled={removeMutation.isPending} onClick={() => { setConfirmingId(null); removeMutation.reset() }}>Keep assignment</Button></div>
            </div>}
          </li>
        })}
      </ul>}
      {removeMutation.isError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(removeMutation.error)}</p>}
      {canManageEvents && <form noValidate className="mt-4 space-y-3" onSubmit={handleSubmit(values => assignMutation.mutate(values))}>
        <Field htmlFor={`assign-${task.id}`} label="Assign an active member" error={errors.user_id?.message}>
          <select id={`assign-${task.id}`} required className={inputClassName} disabled={pending || eligibleMembers.length === 0} aria-invalid={Boolean(errors.user_id)} aria-describedby={errors.user_id ? `assign-${task.id}-error` : undefined} {...register('user_id', { onChange: () => assignMutation.reset() })}>
            <option value="">{eligibleMembers.length ? 'Choose a member…' : 'All active members are already assigned'}</option>
            {eligibleMembers.map(member => <option key={member.user_id} value={member.user_id}>{member.name} · {member.role}</option>)}
          </select>
        </Field>
        {assignMutation.isError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(assignMutation.error)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xs text-xs leading-5 text-slate-500">Tasks support multiple assignees. Viewers retain read-only access.</p><Button type="submit" variant="secondary" busy={assignMutation.isPending} disabled={pending || eligibleMembers.length === 0}><UserPlus size={15} aria-hidden="true" />Assign member</Button></div>
      </form>}
    </>}
  </div>
}
