import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { RefreshCw, UserPlus } from 'lucide-react'
import ConfirmationDialog from '../../../components/ui/ConfirmationDialog'
import { Button, Card, ErrorState, Field, LoadingState, StatusBadge } from '../../../components/ui'
import { inputClassName } from '../../../components/ui/styles'
import { useScopedMutation } from '../../../hooks/useScopedMutation'
import { getErrorMessage } from '../../../services/api'
import { useOrganization } from '../useOrganization'
import { addExistingMember, changeMemberRole, getOrganizationMembers } from './api'
import { administrationKeys, canChangeMemberRole, memberAddSchema, rolesAllowedFor } from './policies'
import type { AssignableRole, MemberAdd, Membership } from './types'

type Change = { action: 'add'; values: MemberAdd } | { action: 'role'; member: Membership; role: AssignableRole }

export default function MembersPanel({ userId, organizationId, reviewerRole }: { userId: string; organizationId: string; reviewerRole: string }) {
  const queryClient = useQueryClient()
  const { retry } = useOrganization()
  const [search, setSearch] = useState('')
  const [confirmation, setConfirmation] = useState<Change | null>(null)
  const [notice, setNotice] = useState('')
  const members = useQuery({
    queryKey: administrationKeys.members(userId, organizationId),
    queryFn: ({ signal }) => getOrganizationMembers(organizationId, signal),
    staleTime: 0,
  })
  const allowedRoles = rolesAllowedFor(reviewerRole)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<MemberAdd>({ resolver: zodResolver(memberAddSchema), defaultValues: { email: '', role: 'Member' } })
  const refresh = () => queryClient.invalidateQueries({ queryKey: administrationKeys.members(userId, organizationId) })
  const change = useScopedMutation<Membership, Change>({
    mutationFn: selection => {
      const role = selection.action === 'add' ? selection.values.role : selection.role
      if (!allowedRoles.includes(role)) throw new Error('Your role cannot grant this permission.')
      if (selection.action === 'add') return addExistingMember(organizationId, selection.values)
      if (!canChangeMemberRole(reviewerRole, userId, selection.member)) throw new Error('You cannot change this membership role.')
      return changeMemberRole(organizationId, selection.member.id, selection.role)
    },
    onSuccess: async (result, selection) => {
      await refresh()
      if (selection.action === 'add') reset()
      setConfirmation(null)
      setNotice(selection.action === 'add' ? `${result.name} now has active ${result.role} access.` : `${result.name}’s role is now ${result.role}.`)
    },
    onError: async () => { await refresh(); retry() },
  })
  const visible = members.data?.filter(member => `${member.name} ${member.email} ${member.role}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []
  function choose(selection: Change) { change.reset(); setNotice(''); setConfirmation(selection) }

  return <section aria-labelledby="members-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="members-heading" className="text-xl font-semibold text-slate-900">Members</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Review current access and manage permitted roles. Only the Owner can grant Admin permissions. Ownership cannot be changed here.</p></div><Button variant="secondary" onClick={() => void refresh()} busy={members.isFetching} disabled={change.isPending}><RefreshCw size={15} aria-hidden="true" />Refresh members</Button></div>
    {notice && <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900">{notice}</p>}
    <Card className="p-5 sm:p-6"><h3 className="font-semibold text-slate-900">Add an existing account</h3><p className="mt-2 text-sm leading-6 text-slate-500">This grants immediate access to an already registered account after confirmation. It does not send an invitation or email. New users may sign up and submit a join request.</p>
      <form noValidate onSubmit={handleSubmit(values => choose({ action: 'add', values }))} className="mt-5 grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto]">
        <Field htmlFor="existing-member-email" label="Registered email address" error={errors.email?.message}><input {...register('email')} id="existing-member-email" type="email" autoComplete="email" className={inputClassName} disabled={change.isPending} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'existing-member-email-error' : undefined} /></Field>
        <Field htmlFor="existing-member-role" label="Membership role" error={errors.role?.message}><select {...register('role')} id="existing-member-role" className={inputClassName} disabled={change.isPending} aria-invalid={Boolean(errors.role)} aria-describedby={errors.role ? 'existing-member-role-error' : undefined}>{allowedRoles.map(role => <option key={role} value={role}>{role}</option>)}</select></Field>
        <Button type="submit" variant="secondary" className="sm:mt-7" disabled={change.isPending}><UserPlus size={15} aria-hidden="true" />Review access</Button>
      </form>
    </Card>
    <div className="max-w-lg"><Field htmlFor="member-search" label="Search members"><input id="member-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name, email, or role" className={inputClassName} /></Field></div>
    {members.isPending ? <LoadingState label="Loading organization members…" /> : members.isError ? <ErrorState title="Unable to load members" error={members.error} onRetry={() => void members.refetch()} /> : <div className="space-y-3">{visible.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No members match this search.</p> : visible.map(member => <MemberRow key={`${member.id}:${member.role}`} member={member} userId={userId} reviewerRole={reviewerRole} allowedRoles={allowedRoles} busy={change.isPending} onReview={role => choose({ action: 'role', member, role })} />)}</div>}
    <ConfirmationDialog open={Boolean(confirmation)} title={confirmation?.action === 'add' ? 'Grant organization access?' : 'Change membership role?'} description={confirmation ? confirmation.action === 'add' ? `Grant active ${confirmation.values.role} access to ${confirmation.values.email} in this organization. This takes effect immediately; no email invitation is sent.` : `Change ${confirmation.member.name} (${confirmation.member.email}) from ${confirmation.member.role} to ${confirmation.role}. This changes their organization permissions immediately.` : undefined} confirmLabel={confirmation?.action === 'add' ? 'Grant access' : 'Change role'} busy={change.isPending} onCancel={() => { setConfirmation(null); change.reset() }} onConfirm={() => { if (confirmation) change.mutate(confirmation) }}>
      {change.isError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(change.error)}</p>}
    </ConfirmationDialog>
  </section>
}

function MemberRow({ member, userId, reviewerRole, allowedRoles, busy, onReview }: { member: Membership; userId: string; reviewerRole: string; allowedRoles: AssignableRole[]; busy: boolean; onReview: (role: AssignableRole) => void }) {
  const [role, setRole] = useState<AssignableRole | ''>(allowedRoles.find(value => value === member.role) ?? '')
  const editable = canChangeMemberRole(reviewerRole, userId, member)
  return <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-slate-900">{member.name}{member.user_id === userId ? ' (you)' : ''}</h3><p className="mt-1 break-all text-sm text-slate-500">{member.email}</p><p className="mt-2 text-xs font-medium text-slate-600">{member.role}</p></div><StatusBadge status={member.status} /></div>
    {editable && <div className="mt-4 flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Field htmlFor={`member-role-${member.id}`} label={`Role for ${member.name}`}><select id={`member-role-${member.id}`} className={inputClassName} value={role} disabled={busy} onChange={event => setRole(event.target.value as AssignableRole)}>{!role && <option value="">Choose a role…</option>}{allowedRoles.map(value => <option key={value} value={value}>{value}</option>)}</select></Field></div><Button variant="secondary" disabled={busy || !role || role === member.role} onClick={() => { if (role) onReview(role) }}>Review role change</Button></div>}
    {!editable && <p className="mt-3 text-xs leading-5 text-slate-400">{member.role === 'Owner' ? 'Owner membership is protected.' : member.user_id === userId ? 'You cannot change your own role.' : member.status !== 'active' ? 'Inactive memberships require separate review before changing access.' : 'Your current role cannot modify this membership.'}</p>}
  </Card>
}
