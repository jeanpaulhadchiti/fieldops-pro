import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Archive } from 'lucide-react'
import { Button, Card, Field } from '../../../components/ui'
import { inputClassName } from '../../../components/ui/styles'
import ConfirmationDialog from '../../../components/ui/ConfirmationDialog'
import { apiRequest, getErrorMessage } from '../../../services/api'
import type { Organization } from '../../../types/api'
import { useScopedMutation } from '../../../hooks/useScopedMutation'
import { useOrganization } from '../useOrganization'


export default function OrganizationArchivePanel({ userId, isOwner }: { userId: string; isOwner: boolean }) {
  const { organization, refreshOrganizations } = useOrganization()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState('')
  const [feedback, setFeedback] = useState('')
  const archived = Boolean(organization?.archived_at)
  const change = useScopedMutation({
    mutationFn: async (confirmationName: string) => {
      if (!organization) throw new Error('Choose an organization first.')
      const result = await apiRequest<Organization>(`/organizations/${organization.id}/${archived ? 'restore' : 'archive'}`, { method: 'POST', body: { confirmation_name: confirmationName } })
      if (result.id !== organization.id || Boolean(result.archived_at) === archived) throw new Error('Refresh the organization before retrying this action.')
      return result
    },
    onSuccess: async result => {
      queryClient.setQueryData<Organization[]>(['organizations', userId], previous => previous?.map(item => item.id === result.id ? result : item))
      setConfirming(false)
      setName('')
      setFeedback(result.archived_at ? 'Organization archived. All existing records are preserved.' : 'Organization restored. Workspace operations are available again.')
      await refreshOrganizations()
    },
  })
  if (!organization) return null
  return <Card className="mt-8 p-5 sm:p-7">
    <div className="flex items-start gap-3">{archived ? <ArchiveRestore className="mt-1 size-5 shrink-0 text-teal-700" aria-hidden="true" /> : <Archive className="mt-1 size-5 shrink-0 text-slate-600" aria-hidden="true" />}<div><h2 className="font-semibold text-slate-900">{archived ? 'Restore organization' : 'Archive organization'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{archived ? 'This workspace is archived and excluded from discovery. Restore it to resume normal operations and its previous discovery preference.' : 'Archiving pauses new workspace changes and removes the organization from discovery. All memberships, events, participants, registrations, tasks, and history are preserved.'}</p><p className="mt-2 text-xs leading-5 text-slate-500">Archiving is reversible and does not permanently delete data. Only the active Owner can archive or restore this organization.</p></div></div>
    {feedback && <p role="status" className="mt-4 rounded-xl bg-teal-50 p-3 text-sm text-teal-900">{feedback}</p>}
    {isOwner && <Button className="mt-4" variant={archived ? 'primary' : 'danger'} onClick={() => { setName(''); setFeedback(''); change.reset(); setConfirming(true) }}>{archived ? 'Restore organization' : 'Archive organization'}</Button>}
    <ConfirmationDialog open={confirming} title={archived ? 'Restore this organization?' : 'Archive this organization?'} description={archived ? `Restore ${organization.name} so its members can resume normal workspace changes. The saved discovery preference will apply again.` : `Archive ${organization.name}. Existing data is retained, new workspace changes stop, and discovery is paused until the Owner restores it.`} confirmLabel={archived ? 'Confirm restoration' : 'Confirm archive'} confirmDisabled={name !== organization.name} danger={!archived} busy={change.isPending} onCancel={() => { setConfirming(false); change.reset() }} onConfirm={() => { if (name === organization.name) change.mutate(name) }}>
      <Field htmlFor="archive-confirmation-name" label="Type the organization name to confirm" hint={organization.name} error={name && name !== organization.name ? 'Enter the organization name exactly as shown.' : undefined}><input id="archive-confirmation-name" value={name} onChange={event => setName(event.target.value)} disabled={change.isPending} autoComplete="off" className={inputClassName} aria-invalid={Boolean(name && name !== organization.name)} aria-describedby={name && name !== organization.name ? 'archive-confirmation-name-hint archive-confirmation-name-error' : 'archive-confirmation-name-hint'} /></Field>
      {change.isError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{getErrorMessage(change.error)}</p>}
    </ConfirmationDialog>
  </Card>
}
