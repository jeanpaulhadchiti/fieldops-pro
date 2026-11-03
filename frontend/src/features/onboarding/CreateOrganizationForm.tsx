import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, CheckCircle2, Search, ShieldCheck } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field } from '../../components/ui'
import ConfirmationDialog from '../../components/ui/ConfirmationDialog'
import CountrySelect from '../../components/ui/CountrySelect'
import { countryName } from '../../data/countries'
import { inputClassName } from '../../components/ui/styles'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { getErrorMessage } from '../../services/api'
import { getSession } from '../../services/session'
import { useOrganization } from '../organizations/useOrganization'
import { createOrganization, discoverOrganizations, isUncertainWrite, possibleDuplicateMatches } from './api'
import OrganizationMatchList from './OrganizationMatchList'
import { organizationDraftSchema } from './schemas'
import { organizationTypes, type OnboardingOrganization, type OrganizationDraft, type OrganizationMatch } from './types'

export default function CreateOrganizationForm({ onJoin }: { onJoin: (match: OrganizationMatch) => void }) {
  const navigate = useNavigate()
  const scope = useOrganization()
  const mounted = useRef(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const [matches, setMatches] = useState<OrganizationMatch[]>([])
  const [reviewDraft, setReviewDraft] = useState<OrganizationDraft | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [reviewedOrganizations, setReviewedOrganizations] = useState(false)
  const [restartConfirm, setRestartConfirm] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [created, setCreated] = useState<OnboardingOrganization | null>(null)
  const { register, handleSubmit, control, setValue, clearErrors, formState: { errors } } = useForm<OrganizationDraft>({
    resolver: zodResolver(organizationDraftSchema),
    defaultValues: { name: '', organization_type: 'Other', organization_type_other: '', country: '', city: '', description: '', is_discoverable: false },
  })
  const selectedType = useWatch({ control, name: 'organization_type' })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function openOrganization(id: string) {
    const version = getSession().version
    setRefreshing(true)
    setError(null)
    try {
      await scope.refreshOrganizations(id)
      if (mounted.current && getSession().version === version) navigate('/dashboard')
    } catch (cause) {
      if (mounted.current && getSession().version === version) setError(cause)
    } finally { if (mounted.current && getSession().version === version) setRefreshing(false) }
  }

  const save = useScopedMutation({
    mutationFn: ({ draft, allow }: { draft: OrganizationDraft; allow: boolean }) => createOrganization(draft, allow),
    onSuccess: async result => {
      setCreated(result)
      setReviewDraft(null)
      setNotice('')
      await openOrganization(result.id)
    },
    onError: (cause, variables) => {
      const duplicates = possibleDuplicateMatches(cause)
      if (duplicates) { setMatches(duplicates); setReviewDraft(variables.draft); setError(null) }
      else { setReviewDraft(null); setError(cause); if (isUncertainWrite(cause)) { setUncertain(true); setReviewedOrganizations(false) } }
    },
  })

  const checkMatches = useScopedMutation({
    mutationFn: (draft: OrganizationDraft) => {
      if (draft.name.length < 3) throw new Error('Enter at least 3 characters in the organization name to search.')
      return discoverOrganizations({ q: draft.name, organization_type: draft.organization_type, country: draft.country, city: draft.city })
    },
    onSuccess: (result, draft) => {
      setMatches(result)
      if (result.length) setReviewDraft(draft)
      else setNotice('No matching discoverable organizations were found. Private organizations are excluded from discovery.')
    },
    onError: cause => setError(cause),
  })

  function submit(draft: OrganizationDraft) {
    if (uncertain || created || save.isPending || checkMatches.isPending) return
    setError(null)
    setNotice('')
    setMatches([])
    save.mutate({ draft, allow: false })
  }

  async function refreshBeforeRestart() {
    const version = getSession().version
    setRefreshing(true)
    setError(null)
    try { await scope.refreshOrganizations(); if (mounted.current && getSession().version === version) setReviewedOrganizations(true) }
    catch (cause) { if (mounted.current && getSession().version === version) setError(cause) }
    finally { if (mounted.current && getSession().version === version) setRefreshing(false) }
  }

  if (created) return <Card className="p-6 sm:p-8"><p role="status" className="flex items-start gap-3 text-sm leading-6 text-teal-900"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal-700" aria-hidden="true" /><span><strong className="break-words">{created.name}</strong> has been created. Your Owner membership was assigned by the server.</span></p>{error != null && <p role="alert" className="mt-4 text-sm leading-6 text-red-800">{getErrorMessage(error)}</p>}<Button className="mt-5" busy={refreshing} onClick={() => void openOrganization(created.id)}>Open organization</Button></Card>

  const busy = save.isPending || checkMatches.isPending || refreshing
  return <Card className="p-5 sm:p-8">
    <div className="mb-6"><h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900"><Building2 className="size-5 text-teal-700" aria-hidden="true" />Create a new organization</h2><p className="mt-2 text-sm leading-6 text-slate-500">Set up a distinct workspace. You’ll become its Owner after the server creates it.</p></div>
    {error != null && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{getErrorMessage(error)}</p>}
    {notice && <p role="status" className="mb-5 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900">{notice}</p>}
    {uncertain && <div className="mb-6 space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p role="status">The creation outcome could not be confirmed. The organization may already have been saved. Refresh and review your actual organizations before starting another attempt.</p><Button variant="secondary" busy={refreshing} onClick={() => void refreshBeforeRestart()}>Refresh my organizations</Button>{reviewedOrganizations && <><ul className="space-y-2">{scope.organizations.map(organization => <li key={organization.id} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words font-semibold">{organization.name}</span><Button variant="ghost" onClick={() => void openOrganization(organization.id)}>Open organization</Button></li>)}</ul><Button variant="secondary" onClick={() => setRestartConfirm(true)}>Start another creation attempt</Button></>}</div>}
    <form noValidate onSubmit={handleSubmit(submit)}>
      <fieldset disabled={busy || uncertain} className="space-y-5">
        <Field label="Organization name *" htmlFor="organization-name" error={errors.name?.message}><input {...register('name')} id="organization-name" maxLength={150} autoComplete="organization" className={inputClassName} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'organization-name-error' : undefined} /></Field>
        <div className="grid gap-5 sm:grid-cols-2"><Field label="Organization type *" htmlFor="organization-type" error={errors.organization_type?.message}><select {...register('organization_type', { onChange: event => { if (event.target.value !== 'Other') { setValue('organization_type_other', '', { shouldDirty: true }); clearErrors('organization_type_other') } } })} id="organization-type" className={inputClassName} aria-invalid={!!errors.organization_type}>{organizationTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></Field><Field label="Country *" htmlFor="organization-country" error={errors.country?.message}><Controller name="country" control={control} render={({ field }) => <CountrySelect id="organization-country" value={field.value} onChange={field.onChange} onBlur={field.onBlur} required invalid={!!errors.country} describedBy={errors.country ? 'organization-country-error' : undefined} />} /></Field></div>
        {selectedType === 'Other' && <Field label="Specify organization type" htmlFor="organization-type-other" error={errors.organization_type_other?.message}><input {...register('organization_type_other')} id="organization-type-other" maxLength={100} className={inputClassName} aria-required="true" aria-invalid={!!errors.organization_type_other} aria-describedby={errors.organization_type_other ? 'organization-type-other-error' : undefined} /></Field>}
        <Field label="City / area *" htmlFor="organization-city" error={errors.city?.message}><input {...register('city')} id="organization-city" autoComplete="address-level2" maxLength={100} className={inputClassName} aria-invalid={!!errors.city} aria-describedby={errors.city ? 'organization-city-error' : undefined} /></Field>
        <Field label="Description" htmlFor="organization-description" error={errors.description?.message}><textarea {...register('description')} id="organization-description" rows={3} maxLength={2000} className={`${inputClassName} resize-y`} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'organization-description-error' : undefined} /></Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><input {...register('is_discoverable')} type="checkbox" className="mt-1 size-4 shrink-0 accent-teal-700" /><span className="text-sm leading-6 text-slate-700"><span className="block font-semibold">Allow organization discovery</span><span className="text-xs leading-5 text-slate-500">Signed-in users may find your name, type, country, and city and request to join. Members and internal records remain protected. Leave unchecked to keep this organization private.</span></span></label>
        <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />Organizations with the same name can be distinct. Review discoverable matches before creating another workspace.</p>
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5"><Button variant="secondary" busy={checkMatches.isPending} onClick={() => { setError(null); setNotice(''); void handleSubmit(draft => checkMatches.mutate(draft))() }}><Search className="size-4" aria-hidden="true" />Check for similar organizations</Button><Button type="submit" busy={save.isPending}>Create organization</Button></div>
      </fieldset>
    </form>
    <ConfirmationDialog open={Boolean(reviewDraft)} title="A similar organization already exists" description="Review these discoverable workspaces and their locations. Request access if one is yours. You may create a separate organization when it is genuinely distinct." confirmLabel="Create distinct organization" busy={save.isPending} onConfirm={() => { if (reviewDraft) { setError(null); save.mutate({ draft: reviewDraft, allow: true }) } }} onCancel={() => setReviewDraft(null)}>
      <OrganizationMatchList matches={matches} action={match => <Button variant="secondary" disabled={save.isPending} onClick={() => { setReviewDraft(null); onJoin(match) }}>Request access</Button>} />
      {reviewDraft && <p className="mt-4 text-sm leading-6 text-slate-600">Creating <strong className="break-words">{reviewDraft.name}</strong> in {reviewDraft.city}, {countryName(reviewDraft.country)} will make a separate workspace with you as its Owner. It grants no access to any existing organization.</p>}
    </ConfirmationDialog>
    <ConfirmationDialog open={restartConfirm} title="Start another creation attempt?" description="A previous request may have created an organization. Continue only after checking the refreshed list above. A new attempt can create a separate workspace." confirmLabel="I reviewed my organizations" onCancel={() => setRestartConfirm(false)} onConfirm={() => { setRestartConfirm(false); setUncertain(false); setError(null); setNotice('Review the form before submitting a new creation request.') }} />
  </Card>
}
