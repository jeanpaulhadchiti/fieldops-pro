import { useEffect, useRef, useState } from 'react'
import { Building2, CalendarDays, ChevronDown, ClipboardList, Compass, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Users, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/useAuth'
import { useOrganization } from '../../features/organizations/useOrganization'
import NotificationBell from '../../features/notifications/NotificationBell'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const { organizations, organization, membership, selectOrganization, canManageEvents } = useOrganization()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const mobilePanel = useRef<HTMLDivElement>(null)

  function closeMenu() {
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!menuOpen) return
    const trigger = menuTrigger.current
    closeButton.current?.focus()
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const desktop = window.matchMedia('(min-width: 1024px)')
    function handleResize(event: MediaQueryListEvent) {
      if (event.matches) setMenuOpen(false)
    }
    desktop.addEventListener('change', handleResize)
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
      if (event.key === 'Tab') {
        const items = mobilePanel.current?.querySelectorAll<HTMLElement>('button, a[href]')
        if (!items?.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', handleKey)
      desktop.removeEventListener('change', handleResize)
      trigger?.focus()
    }
  }, [menuOpen])

  const navigation = <nav aria-label="Main navigation" className="space-y-1.5">
    {[
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { to: '/events', label: 'Events', icon: CalendarDays },
      { to: '/participants', label: 'Participants', icon: Users },
      { to: '/tasks', label: 'Tasks', icon: ClipboardList },
      ...(canManageEvents || ['Owner', 'Admin'].includes(membership?.role ?? '') ? [{ to: '/settings/members', label: 'Settings', icon: Settings }] : []),
    ].map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={closeMenu} className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors ${isActive ? 'bg-teal-400/15 text-teal-300 ring-1 ring-inset ring-teal-400/15' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
      <Icon className="size-[19px]" aria-hidden="true" />{label}
    </NavLink>)}
  </nav>

  const brand = <NavLink to="/dashboard" onClick={closeMenu} className="flex items-center gap-3" aria-label="FieldOps Pro home">
    <div className="flex size-10 items-center justify-center rounded-xl bg-teal-400 text-slate-950"><Compass className="size-6" aria-hidden="true" /></div>
    <div><span className="block text-lg font-bold tracking-tight text-white">FieldOps<span className="ml-1 text-teal-300">Pro</span></span><span className="block text-[10px] font-medium tracking-[0.18em] text-slate-500 uppercase">Operations workspace</span></div>
  </NavLink>

  const account = <div className="border-t border-white/10 pt-5">
    <NavLink to="/onboarding" onClick={closeMenu} className={({ isActive }) => `mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive ? 'bg-teal-400/15 text-teal-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Building2 className="size-4 shrink-0" aria-hidden="true" />Manage organizations</NavLink>
    <div className="mb-4 flex items-center gap-3 px-1"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white" aria-hidden="true">{user?.name?.trim().slice(0, 2).toUpperCase() || 'FO'}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{user?.name}</p><p className="truncate text-xs text-slate-400">{user?.email}</p></div></div>
    <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white"><LogOut className="size-4" aria-hidden="true" />Sign out</button>
  </div>

  return <div className="min-h-svh">
    <a href="#main-content" inert={menuOpen} className="fixed top-3 left-3 z-70 -translate-y-24 rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white focus:translate-y-0">Skip to content</a>
    <aside inert={menuOpen} className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto bg-[#101f2c] px-5 py-7 lg:flex">
      {brand}<p className="mt-12 mb-4 px-3 text-[10px] font-semibold tracking-[0.18em] text-slate-500 uppercase">Workspace</p>{navigation}
      <div className="mt-auto pt-8"><div className="mb-6 rounded-xl border border-white/8 bg-white/3 p-4"><ShieldCheck className="mb-2 size-5 text-teal-400" aria-hidden="true" /><p className="text-xs font-semibold text-slate-200">Your team. In sync.</p><p className="mt-1 text-xs leading-5 text-slate-500">One place to plan your next operation.</p></div>{account}</div>
    </aside>
    {menuOpen && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-slate-950/50" onClick={closeMenu} aria-hidden="true" /><div ref={mobilePanel} role="dialog" aria-modal="true" aria-label="Navigation menu" className="relative flex h-full w-[min(20rem,90vw)] flex-col overflow-y-auto bg-[#101f2c] p-5"><div className="mb-8 flex items-center justify-between gap-2">{brand}<button ref={closeButton} onClick={closeMenu} aria-label="Close navigation" className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><X className="size-5" /></button></div>{navigation}<div className="mt-auto">{account}</div></div></div>}
    <div inert={menuOpen} className="lg:pl-64">
      <header className="flex min-h-21 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3"><button ref={menuTrigger} onClick={() => setMenuOpen(true)} aria-label="Open navigation" aria-expanded={menuOpen} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu className="size-5" /></button><div className="min-w-0"><p className="hidden text-[10px] font-bold tracking-widest text-slate-400 uppercase sm:block">Organization</p><div className="relative mt-0.5"><label className="sr-only" htmlFor="workspace-organization">Select organization</label><select id="workspace-organization" disabled={!organizations.length} value={organization?.id || ''} onChange={event => { selectOrganization(event.target.value); if (location.pathname.startsWith('/events/')) navigate('/events'); else if (location.pathname.startsWith('/participants/')) navigate('/participants'); else if (location.pathname === '/settings/members') navigate('/settings/members') }} className="max-w-[35vw] appearance-none truncate rounded-md bg-transparent py-1 pr-6 text-sm font-semibold text-slate-800 sm:max-w-80">
          {!organizations.length && <option value="">No organizations</option>}{organizations.map(org => <option key={org.id} value={org.id}>{org.name}{org.archived_at ? ' (Archived)' : ''}</option>)}
        </select><ChevronDown className="pointer-events-none absolute top-2 right-0 size-4 text-slate-400" aria-hidden="true" /></div></div></div>
        <div className="flex shrink-0 items-center gap-3">{user && <NotificationBell key={user.id} userId={user.id} />}<span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{membership?.role || 'Workspace'}</span><div className="hidden h-7 w-px bg-slate-200 sm:block" /><span className="hidden text-xs text-slate-500 sm:block">FieldOps Pro</span></div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] p-4 outline-none sm:p-8 xl:p-10"><Outlet /></main>
      <footer className="flex flex-wrap justify-between gap-2 px-4 pb-6 text-[11px] text-slate-400 sm:px-8 xl:px-10"><span>FieldOps Pro · Operations, organized.</span><span>Built for the teams in the field.</span></footer>
    </div>
  </div>
}
