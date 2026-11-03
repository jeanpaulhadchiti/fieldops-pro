import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Globe, LockKeyhole } from 'lucide-react'
import ConfirmationDialog from '../../../components/ui/ConfirmationDialog'
import CountrySelect from '../../../components/ui/CountrySelect'
import { countryCode } from '../../../data/countries'
import { Button, Card, ErrorState, Field, LoadingState } from '../../../components/ui'
import { inputClassName } from '../../../components/ui/styles'
import { useScopedMutation } from '../../../hooks/useScopedMutation'
import { getErrorMessage } from '../../../services/api'
import { useOrganization } from '../useOrganization'
import { getOrganizationProfile, saveOrganizationProfile } from './api'
import { administrationKeys, organizationProfileSchema } from './policies'
import type { OrganizationProfileInput, OrganizationProfileValues } from './policies'
import { organizationTypes } from './types'
import type { OrganizationProfile } from './types'

export default function OrganizationProfilePanel({ userId, organizationId }: { userId: string; organizationId: string }) {
  const profile = useQuery({
    queryKey: administrationKeys.profile(userId, organizationId),
    queryFn: ({ signal }) => getOrganizationProfile(organizationId, signal),
  })
  if (profile.isPending) return <LoadingState label="Loading organization settings…" />
  if (profile.isError) return <ErrorState title="Unable to load organization settings" error={profile.error} onRetry={() => void profile.refetch()} />
  return <ProfileForm key={organizationId} profile={profile.data} userId={userId} />
}

function formValues(profile: OrganizationProfile): OrganizationProfileInput {
  return { name: profile.name, organization_type: profile.organization_type, organization_type_other: profile.organization_type_other ?? '', legacy_unspecified_type: profile.organization_type === 'Other' && !profile.organization_type_other, country: countryCode(profile.country ?? '') ?? profile.country ?? '', city: profile.city ?? '', description: profile.description ?? '', is_discoverable: profile.is_discoverable }
}

function ProfileForm({ profile, userId }: { profile: OrganizationProfile; userId: string }) {
  const { refreshOrganizations, retry } = useOrganization()
  const queryClient = useQueryClient()
  const [confirmation, setConfirmation] = useState<OrganizationProfileValues | null>(null)
  const [notice, setNotice] = useState('')
  const { register, handleSubmit, reset, control, setValue, clearErrors, formState: { errors, isDirty } } = useForm<OrganizationProfileInput, unknown, OrganizationProfileValues>({ resolver: zodResolver(organizationProfileSchema), defaultValues: formValues(profile) })
  const selectedType = useWatch({ control, name: 'organization_type' })
  const save = useScopedMutation<OrganizationProfile, OrganizationProfileValues>({
    mutationFn: values => saveOrganizationProfile(profile.id, values),
    onSuccess: async result => {
      queryClient.setQueryData(administrationKeys.profile(userId, profile.id), result)
      await refreshOrganizations()
      reset(formValues(result))
      setConfirmation(null)
      setNotice('Organization settings saved.')
    },
    onError: () => { retry() },
  })

  return <section aria-labelledby="organization-profile-heading">
    <h2 id="organization-profile-heading" className="text-xl font-semibold text-slate-900">Organization profile</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Manage the details people use to recognize your organization and choose whether signed-in users can discover it.</p>
    {notice && <p role="status" className="mt-5 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{notice}</p>}
    <Card className="mt-5 p-5 sm:p-6"><form noValidate className="space-y-5" onSubmit={handleSubmit(values => { save.reset(); setNotice(''); setConfirmation(values) })}>
      <Field htmlFor="organization-name" label="Organization name *" error={errors.name?.message}><input {...register('name')} id="organization-name" className={inputClassName} autoComplete="organization" maxLength={150} disabled={save.isPending} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'organization-name-error' : undefined} /></Field>
      <div className="grid gap-5 sm:grid-cols-2"><Field htmlFor="organization-type" label="Organization type *" error={errors.organization_type?.message}><select {...register('organization_type', { onChange: event => { setValue('legacy_unspecified_type', false); if (event.target.value !== 'Other') { setValue('organization_type_other', '', { shouldDirty: true }); clearErrors('organization_type_other') } } })} id="organization-type" className={inputClassName} disabled={save.isPending} aria-invalid={Boolean(errors.organization_type)} aria-describedby={errors.organization_type ? 'organization-type-error' : undefined}>{organizationTypes.map(value => <option key={value} value={value}>{value}</option>)}</select></Field><Field htmlFor="organization-country" label="Country" error={errors.country?.message}><Controller name="country" control={control} render={({ field }) => <CountrySelect id="organization-country" value={field.value} onChange={field.onChange} onBlur={field.onBlur} disabled={save.isPending} invalid={!!errors.country} describedBy={errors.country ? 'organization-country-error' : undefined} />} /></Field></div>
      {selectedType === 'Other' && <Field label="Specify organization type" htmlFor="organization-type-other" error={errors.organization_type_other?.message}><input {...register('organization_type_other')} id="organization-type-other" maxLength={100} className={inputClassName} disabled={save.isPending} aria-required="true" aria-invalid={!!errors.organization_type_other} aria-describedby={errors.organization_type_other ? 'organization-type-other-error' : undefined} /></Field>}
      <Field htmlFor="organization-city" label="City / area" error={errors.city?.message}><input {...register('city')} id="organization-city" className={inputClassName} autoComplete="address-level2" maxLength={100} disabled={save.isPending} aria-invalid={Boolean(errors.city)} aria-describedby={errors.city ? 'organization-city-error' : undefined} /></Field>
      <Field htmlFor="organization-description" label="Description" error={errors.description?.message} hint="This description remains visible only inside your organization."><textarea {...register('description')} id="organization-description" rows={4} maxLength={2000} className={inputClassName} disabled={save.isPending} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'organization-description-error organization-description-hint' : 'organization-description-hint'} /></Field>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><label className="flex items-start gap-3" htmlFor="organization-discoverable"><input {...register('is_discoverable')} id="organization-discoverable" type="checkbox" disabled={save.isPending} aria-describedby="organization-discoverable-hint" className="mt-1 size-4 shrink-0 accent-teal-700" /><span><span className="text-sm font-semibold text-slate-900">Allow organization discovery</span><span id="organization-discoverable-hint" className="mt-1 block text-xs leading-6 text-slate-600">Signed-in users may see the name, type, country, and city and request to join. Member details, administrator identity, description, and internal records stay private. Requests grant no access until an authorized review.</span></span></label></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs leading-5 text-slate-500">An organization can share a name with another group. Saving a profile never merges workspaces or changes ownership.</p><Button type="submit" disabled={!isDirty || save.isPending}>Review settings</Button></div>
    </form></Card>
    <ConfirmationDialog open={Boolean(confirmation)} title="Save organization settings?" description={confirmation ? `Save the profile for ${confirmation.name}. ${confirmation.is_discoverable ? 'Signed-in users will be able to discover its public card and request access.' : 'The organization will be private and excluded from discovery. Existing memberships and submitted request history are preserved.'}` : undefined} confirmLabel="Save settings" busy={save.isPending} onCancel={() => { setConfirmation(null); save.reset() }} onConfirm={() => { if (confirmation) save.mutate(confirmation) }}>
      {confirmation && <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-medium text-slate-700">{confirmation.is_discoverable ? <Globe size={17} aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}{confirmation.is_discoverable ? 'Discoverable to signed-in users' : 'Private organization'}</p>}
      {save.isError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(save.error)}</p>}
    </ConfirmationDialog>
  </section>
}
