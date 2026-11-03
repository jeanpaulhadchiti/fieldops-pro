import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, MailCheck, ShieldCheck, Users } from 'lucide-react'
import { Card, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { buttonClassName } from '../components/ui/styles'
import { useAuth } from '../features/auth/useAuth'
import { useOrganization } from '../features/organizations/useOrganization'
import JoinRequestsPanel from '../features/organizations/admin/JoinRequestsPanel'
import MembersPanel from '../features/organizations/admin/MembersPanel'
import OrganizationProfilePanel from '../features/organizations/admin/OrganizationProfilePanel'
import OrganizationArchivePanel from '../features/organizations/admin/OrganizationArchivePanel'

export default function OrganizationSettingsPage() {
  const { user } = useAuth()
  const { organization, organizations, membership, selectOrganization, retry } = useOrganization()
  const [params] = useSearchParams()
  const requestedId = params.get('organization')
  const targetAvailable = organizations.some(item => item.id === requestedId)
  useEffect(() => {
    if (requestedId && targetAvailable && organization?.id !== requestedId) {
      selectOrganization(requestedId)
    }
  }, [requestedId, targetAvailable, organization?.id, selectOrganization])
  if (requestedId && !targetAvailable) return <ErrorState title="Organization unavailable" error={new Error('An active membership for this organization could not be verified. Refresh your organizations or contact its Owner.')} onRetry={retry} />
  if (requestedId && organization?.id !== requestedId) return <LoadingState label="Opening organization settings…" />
  if (!user || !organization || !membership || !['Owner', 'Admin'].includes(membership.role)) return <>
    <PageHeader eyebrow="Settings" title="Organization administration" description="An active Owner or Admin membership is required to review join requests and manage organization settings." />
    <Card className="p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-1 size-6 shrink-0 text-teal-700" aria-hidden="true" /><div><h2 className="font-semibold text-slate-900">Administration access required</h2><p className="mt-2 text-sm leading-6 text-slate-500">Ask your organization’s Owner or Admin to review membership access. Your existing workspace features remain available according to your role.</p><Link to="/dashboard" className={`${buttonClassName('secondary')} mt-4`}>Return to overview</Link></div></div></Card>
  </>
  return <SettingsWorkspace key={`${user.id}:${organization.id}:${membership.role}`} userId={user.id} organizationId={organization.id} organizationName={organization.name} reviewerRole={membership.role} />
}

function SettingsWorkspace({ userId, organizationId, organizationName, reviewerRole }: { userId: string; organizationId: string; organizationName: string; reviewerRole: string }) {
  const { organization } = useOrganization()
  const [params, setParams] = useSearchParams()
  const section = ['requests', 'members', 'profile'].includes(params.get('section') ?? '') ? params.get('section') : 'requests'
  const archived = Boolean(organization?.archived_at)
  const sections = [{ id: 'requests' as const, label: 'Join requests', icon: MailCheck }, { id: 'members' as const, label: 'Members', icon: Users }, { id: 'profile' as const, label: 'Organization profile', icon: Building2 }]
  return <>
    <PageHeader eyebrow="Settings · Members" title="Organization settings" description={`Manage membership requests, access, and discovery for ${organizationName}.`} action={<Link to="/onboarding" className={buttonClassName('secondary')}>Create or join another organization</Link>} />
    {archived && <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Archived organization · These records are preserved for review. The active Owner can restore the workspace below to resume changes.</p>}
    <nav aria-label="Organization settings sections" className="mb-7 flex flex-wrap gap-2 border-b border-slate-200 pb-4">{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={section === id} onClick={() => setParams({ section: id })} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${section === id ? 'bg-teal-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}><Icon size={16} aria-hidden="true" />{label}</button>)}</nav>
    <fieldset disabled={archived} className="min-w-0">{section === 'requests' ? <JoinRequestsPanel key={`${params.get('request')}:${params.get('status')}`} userId={userId} organizationId={organizationId} /> : section === 'members' ? <MembersPanel userId={userId} organizationId={organizationId} reviewerRole={reviewerRole} /> : <OrganizationProfilePanel userId={userId} organizationId={organizationId} />}</fieldset>
    <OrganizationArchivePanel userId={userId} isOwner={reviewerRole === 'Owner'} />
  </>
}
