import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button, Field } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { getErrorMessage } from '../../services/api'
import { useOrganization } from '../organizations/useOrganization'
import { createParticipant, participantKeys } from './queries'
import { participantFormSchema } from './schema'
import type { ParticipantFormValues } from './schema'
import type { Participant } from './types'

export default function ParticipantCreateForm({ onCreated, onCancel }: { onCreated?: (participant: Participant) => void; onCancel?: () => void }) {
  const { organization, canManageEvents } = useOrganization()
  const queryClient = useQueryClient()
  const { register, handleSubmit, reset, setFocus, formState: { errors } } = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantFormSchema), defaultValues: { full_name: '' },
  })
  useEffect(() => { setFocus('full_name') }, [setFocus])
  const create = useScopedMutation<Participant, ParticipantFormValues>({
    mutationFn: values => {
      if (!organization || !canManageEvents) throw new Error('An active Owner or Admin can create participants.')
      return createParticipant({ organization_id: organization.id, full_name: values.full_name })
    },
    onSuccess: async participant => {
      reset()
      onCreated?.(participant)
      await queryClient.invalidateQueries({ queryKey: participantKeys.organization(participant.organization_id) })
    },
  })

  if (!organization || !canManageEvents) return null
  return <form noValidate onSubmit={handleSubmit(values => create.mutate(values))} className="space-y-5">
    <div><h2 className="text-lg font-semibold text-slate-900">Add a participant</h2><p className="mt-1 text-sm leading-6 text-slate-500">Create a participant in {organization.name}. You can register them for an event afterwards.</p></div>
    {create.isError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{getErrorMessage(create.error)}</p>}
    <fieldset disabled={create.isPending} className="disabled:opacity-60"><legend className="sr-only">Participant information</legend>
      <Field label="Full name *" htmlFor="participant-full-name" error={errors.full_name?.message} hint="Required · up to 150 characters.">
        <input {...register('full_name')} id="participant-full-name" autoComplete="name" required maxLength={150} className={inputClassName} placeholder="Participant’s full name" aria-invalid={Boolean(errors.full_name)} aria-describedby={`participant-full-name-hint${errors.full_name ? ' participant-full-name-error' : ''}`} />
      </Field>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-3">{onCancel && <Button variant="secondary" onClick={onCancel} disabled={create.isPending}>Cancel</Button>}<Button type="submit" busy={create.isPending}><UserPlus size={16} aria-hidden="true" />{create.isPending ? 'Adding participant…' : 'Add participant'}</Button></div>
  </form>
}
