import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Card, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { buttonClassName } from '../../components/ui/styles'
import { useOrganization } from './useOrganization'

export function OrganizationGate() {
  const scope = useOrganization()
  const location = useLocation()
  if (scope.isLoading) return <LoadingState label="Loading your organization…" />
  if (scope.error) return <ErrorState title="Unable to load your workspace" error={scope.error} onRetry={scope.retry} />
  if (!scope.organization) return <Navigate to="/onboarding" replace />
  if (scope.organization.archived_at && location.pathname !== '/settings/members') return <>
    <PageHeader eyebrow="Archived workspace" title={scope.organization.name} description="This organization is archived. Its data and memberships are preserved, and normal workspace changes are paused." />
    <Card className="p-6"><p className="text-sm leading-6 text-slate-600">Select another organization to continue working. The active Owner can restore this organization in settings.</p><div className="mt-4 flex flex-wrap gap-3">{['Owner', 'Admin'].includes(scope.membership?.role ?? '') && <Link to="/settings/members" className={buttonClassName('primary')}>Organization settings</Link>}<Link to="/onboarding" className={buttonClassName('secondary')}>Manage organizations</Link></div></Card>
  </>
  return <Outlet key={scope.organization.id} />
}
