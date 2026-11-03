import { useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, UsersRound } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { buttonClassName } from '../components/ui/styles'
import CreateOrganizationForm from '../features/onboarding/CreateOrganizationForm'
import JoinOrganizationPanel from '../features/onboarding/JoinOrganizationPanel'
import MyJoinRequests from '../features/onboarding/MyJoinRequests'
import type { OrganizationMatch } from '../features/onboarding/types'
import { useOrganization } from '../features/organizations/useOrganization'

export default function OnboardingPage() {
  const scope = useOrganization()
  const [params, setParams] = useSearchParams()
  const [initialMatch, setInitialMatch] = useState<OrganizationMatch | null>(null)
  const view = params.get('view')
  const mode = view === 'create' || view === 'join' ? view : null

  function choose(next: 'create' | 'join', match: OrganizationMatch | null = null) {
    setInitialMatch(match)
    setParams({ view: next })
  }

  if (scope.isLoading && !scope.organizations.length) return <LoadingState label="Loading your organization choices…" />
  if (scope.error) return <ErrorState title="Unable to load your organizations" error={scope.error} onRetry={scope.retry} />

  return <div className="mx-auto max-w-5xl space-y-7">
    <PageHeader eyebrow="Organization onboarding" title="Welcome to FieldOps Pro" description="Create a workspace for your team, or request membership in an existing organization. Each organization controls its own access." action={scope.organization ? <Link to="/dashboard" className={buttonClassName('secondary')}><ArrowLeft className="size-4" aria-hidden="true" />Back to workspace</Link> : undefined} />
    <div className="grid gap-4 sm:grid-cols-2" aria-label="Organization onboarding choices">
      {[{ value: 'create' as const, title: 'Create a new organization', description: 'Set up a distinct workspace and become its Owner.', icon: Building2 }, { value: 'join' as const, title: 'Join an existing organization', description: 'Find your team and request approval to become a Member.', icon: UsersRound }].map(({ value, title, description, icon: Icon }) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => choose(value)} className={`flex items-start gap-4 rounded-2xl border p-5 text-left shadow-xs transition-colors sm:p-6 ${mode === value ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-400' : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50'}`}><span className="rounded-xl bg-teal-100 p-3 text-teal-800"><Icon className="size-5" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-base font-semibold text-slate-900">{title}</span><span className="mt-2 block text-sm leading-6 text-slate-500">{description}</span></span><ArrowRight className="mt-1 size-4 shrink-0 text-teal-700" aria-hidden="true" /></button>)}
    </div>
    {mode === 'create' && <CreateOrganizationForm onJoin={match => choose('join', match)} />}
    {mode === 'join' && <JoinOrganizationPanel key={initialMatch?.id ?? 'search'} initialMatch={initialMatch} />}
    {!mode && <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm leading-6 text-slate-600">Choose how you’d like to get started. Signing up alone never adds you to another organization.</p>}
    <MyJoinRequests />
    {mode && <div className="text-center"><Button variant="ghost" onClick={() => { setInitialMatch(null); setParams({}) }}>Back to onboarding choices</Button></div>}
  </div>
}
