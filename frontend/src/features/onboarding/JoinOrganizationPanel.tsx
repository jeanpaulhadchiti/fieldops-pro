import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ShieldCheck } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, Card, EmptyState, ErrorState, Field, LoadingState } from '../../components/ui'
import ConfirmationDialog from '../../components/ui/ConfirmationDialog'
import CountrySelect from '../../components/ui/CountrySelect'
import { countryName } from '../../data/countries'
import { inputClassName } from '../../components/ui/styles'
import { useScopedMutation } from '../../hooks/useScopedMutation'
import { getErrorMessage } from '../../services/api'
import { useAuth } from '../auth/useAuth'
import { useOrganization } from '../organizations/useOrganization'
import { discoverOrganizations, getOwnJoinRequests, requestToJoin } from './api'
import OrganizationMatchList from './OrganizationMatchList'
import { onboardingKeys } from './queryKeys'
import { discoveryFormSchema, joinMessageSchema } from './schemas'
import { organizationTypes, type DiscoverySearch, type OrganizationMatch } from './types'

type SearchValues = z.infer<typeof discoveryFormSchema>
type MessageValues = z.infer<typeof joinMessageSchema>

export default function JoinOrganizationPanel({ initialMatch }: { initialMatch: OrganizationMatch | null }) {
  const { user } = useAuth()
  const { organizations } = useOrganization()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState<DiscoverySearch | null>(() => initialMatch ? { q: initialMatch.name } : null)
  const [selected, setSelected] = useState<OrganizationMatch | null>(initialMatch)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<unknown>(null)
  const form = useForm<SearchValues>({ resolver: zodResolver(discoveryFormSchema), defaultValues: { q: initialMatch?.name ?? '', organization_type: '', country: '', city: '' } })
  const messageForm = useForm<MessageValues>({ resolver: zodResolver(joinMessageSchema), defaultValues: { message: '' } })
  const discovery = useQuery({
    queryKey: onboardingKeys.discovery(user!.id, search),
    queryFn: ({ signal }) => discoverOrganizations(search!, signal),
    enabled: Boolean(search), retry: false, refetchOnWindowFocus: false,
  })
  const ownRequests = useQuery({ queryKey: onboardingKeys.ownRequests(user!.id, 1), queryFn: ({ signal }) => getOwnJoinRequests(1, signal) })
  const save = useScopedMutation({
    mutationFn: ({ organizationId, message }: { organizationId: string; message: string }) => requestToJoin(organizationId, message),
    onSuccess: async result => {
      setSelected(null)
      messageForm.reset()
      setError(null)
      setNotice(`Your request to ${result.organization_name} is pending. An Owner or Admin must approve it before you can enter the workspace.`)
      await queryClient.invalidateQueries({ queryKey: ['my-join-requests', user!.id] })
    },
    onError: cause => { setError(cause); void queryClient.invalidateQueries({ queryKey: ['my-join-requests', user!.id] }) },
  })

  function submitSearch(values: SearchValues) {
    setNotice('')
    setError(null)
    const next = { q: values.q, organization_type: values.organization_type || undefined, country: values.country || undefined, city: values.city || undefined }
    if (JSON.stringify(next) === JSON.stringify(search)) void discovery.refetch()
    else setSearch(next)
  }

  function select(match: OrganizationMatch) {
    setError(null)
    messageForm.reset()
    setSelected(match)
  }

  return <Card className="p-5 sm:p-8">
    <h2 className="text-xl font-semibold text-slate-900">Join an existing organization</h2><p className="mt-2 text-sm leading-6 text-slate-500">Find a discoverable workspace and ask its team to review your request.</p>
    <p className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />Search shows only organizations that have enabled discovery. Private organizations and their members are excluded. Contact a private organization through a channel you already trust.</p>
    <form noValidate onSubmit={form.handleSubmit(submitSearch)} className="mt-6 space-y-4">
      <Field label="Organization name" htmlFor="discover-name" error={form.formState.errors.q?.message} hint="Enter at least 3 characters. Search is available to signed-in users and is rate limited."><div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" aria-hidden="true" /><input {...form.register('q')} id="discover-name" type="search" maxLength={150} className={`${inputClassName} pl-10`} aria-invalid={!!form.formState.errors.q} aria-describedby={`discover-name-hint${form.formState.errors.q ? ' discover-name-error' : ''}`} /></div></Field>
      <div className="grid gap-4 sm:grid-cols-3"><Field label="Type" htmlFor="discover-type" error={form.formState.errors.organization_type?.message}><select {...form.register('organization_type')} id="discover-type" className={inputClassName}><option value="">Any type</option>{organizationTypes.map(type => <option value={type} key={type}>{type}</option>)}</select></Field><Field label="Country" htmlFor="discover-country" error={form.formState.errors.country?.message}><Controller name="country" control={form.control} render={({ field }) => <CountrySelect id="discover-country" value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={!!form.formState.errors.country} />} /></Field><Field label="City / area" htmlFor="discover-city" error={form.formState.errors.city?.message}><input {...form.register('city')} id="discover-city" maxLength={100} className={inputClassName} /></Field></div>
      <div className="flex justify-end"><Button type="submit" busy={discovery.isFetching}><Search className="size-4" aria-hidden="true" />Search organizations</Button></div>
    </form>
    {notice && <p role="status" className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900">{notice}</p>}
    {search && <div className="mt-6 border-t border-slate-100 pt-6"><h3 className="mb-4 break-words text-sm font-semibold text-slate-700">Discoverable matches for “{search.q}”</h3>{discovery.isPending ? <LoadingState label="Searching discoverable organizations…" /> : discovery.isError ? <ErrorState title="Organization search unavailable" error={discovery.error} onRetry={() => void discovery.refetch()} /> : !discovery.data.length ? <EmptyState title="No discoverable matches" description="Try a more specific name or adjust the location and type. A private organization will not appear in search." /> : <><OrganizationMatchList matches={discovery.data} action={match => {
      const member = organizations.some(organization => organization.id === match.id)
      const pending = ownRequests.data?.some(request => request.organization_id === match.id && request.status === 'pending')
      return <Button variant="secondary" disabled={member || pending || save.isPending} onClick={() => select(match)}>{member ? 'Already a member' : pending ? 'Request pending' : 'Request to join'}</Button>
    }} /><p className="mt-4 text-xs leading-5 text-slate-500">Up to 10 matches are shown. Add a location or a more specific name to narrow your search. Matching names do not confirm an organization’s identity.</p></>}</div>}
    <ConfirmationDialog open={Boolean(selected)} title="Request to join organization" description={selected ? `Send a membership request to ${selected.name}. Only an authorized Owner or Admin can approve it. Approval grants an ordinary Member role.` : undefined} confirmLabel="Send join request" busy={save.isPending} onCancel={() => { setSelected(null); setError(null) }} onConfirm={() => void messageForm.handleSubmit(values => { if (selected) { setError(null); save.mutate({ organizationId: selected.id, message: values.message }) } })()}>
      {selected && <div className="mb-4 text-sm leading-6 text-slate-600"><p className="break-words font-semibold text-slate-900">{selected.name}</p><p>{[selected.organization_type === 'Other' ? selected.organization_type_other || 'Other' : selected.organization_type, selected.city, countryName(selected.country)].filter(Boolean).join(' · ')}</p></div>}
      {error != null && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(error)} You can refresh your requests after closing this dialog to check the saved status.</p>}
      <Field label="Message (optional)" htmlFor="join-message" error={messageForm.formState.errors.message?.message} hint="Introduce yourself to the organization’s reviewers. Do not include passwords or sensitive personal information."><textarea {...messageForm.register('message')} id="join-message" rows={4} maxLength={1000} className={`${inputClassName} resize-y`} disabled={save.isPending} aria-invalid={!!messageForm.formState.errors.message} aria-describedby={`join-message-hint${messageForm.formState.errors.message ? ' join-message-error' : ''}`} /></Field>
    </ConfirmationDialog>
  </Card>
}
