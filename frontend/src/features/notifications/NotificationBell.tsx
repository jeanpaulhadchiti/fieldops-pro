import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, RefreshCw, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, ErrorState } from '../../components/ui'
import { useOrganization } from '../organizations/useOrganization'
import { getErrorMessage } from '../../services/api'
import { getSession, subscribeSession } from '../../services/session'
import { getNotifications, notificationKeys, notificationTarget, setNotificationRead } from './api'
import type { JoinNotification } from './api'

export default function NotificationBell({ userId }: { userId: string }) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  const queryClient = useQueryClient()
  const { refreshOrganizations } = useOrganization()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const submitting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const feed = useQuery({
    queryKey: notificationKeys.page(userId, session.version, page),
    queryFn: ({ signal }) => getNotifications(page, signal),
    enabled: Boolean(userId && session.token),
    refetchInterval: 30_000,
    staleTime: 0,
  })

  useEffect(() => {
    if (!open) return
    function closeOnOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function update(item: JoinNotification, isRead: boolean, view = false) {
    if (submitting.current) return
    submitting.current = true
    const version = getSession().version
    const current = () => mounted.current && getSession().version === version
    setBusyId(item.id)
    setError('')
    try {
      await setNotificationRead(item, isRead)
      await queryClient.invalidateQueries({ queryKey: notificationKeys.recipient(userId, version) })
      if (view && current()) {
        await refreshOrganizations(item.organization_id)
        if (current()) { setOpen(false); navigate(notificationTarget(item)) }
      }
    } catch (caught) {
      if (current()) setError(getErrorMessage(caught))
    } finally {
      submitting.current = false
      if (current()) setBusyId(null)
    }
  }

  const unread = feed.data?.unread_count ?? 0
  return <div ref={container} className="relative">
    <button ref={trigger} type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-controls="notification-feed" onClick={() => setOpen(value => !value)} className="relative rounded-xl p-2.5 text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-600">
      <Bell size={21} aria-hidden="true" />
      {unread > 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-5 rounded-full bg-teal-700 px-1 text-center text-[10px] leading-5 font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section id="notification-feed" aria-label="Notifications" className="fixed top-20 right-4 z-40 mt-3 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:absolute sm:top-full sm:right-0">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Notifications <span className="text-xs font-normal text-slate-500">{unread} unread</span></h2><div className="flex gap-1"><button type="button" aria-label="Refresh notifications" disabled={feed.isFetching} onClick={() => void feed.refetch()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw size={16} aria-hidden="true" /></button><button type="button" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus() }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={16} aria-hidden="true" /></button></div></div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-800">{error}</p>}
      {feed.isPending ? <p role="status" className="py-6 text-sm text-slate-500">Loading notifications…</p> : feed.isError ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} title="Unable to load notifications" /> : !feed.data.items.length ? <p className="py-6 text-sm text-slate-500">No notifications on this page.</p> : <ul className="max-h-[min(65svh,32rem)] space-y-3 overflow-y-auto">
        {feed.data.items.map(item => <li key={item.id} className={`rounded-xl border p-3 ${item.read_at ? 'border-slate-200 bg-white' : 'border-teal-200 bg-teal-50/50'}`}>
          <p className="break-words text-sm leading-6 text-slate-800"><strong>{item.applicant_name}</strong> {item.status === 'pending' ? 'requested to join' : `had a join request ${item.status} for`} <strong>{item.organization_name}</strong>.</p>
          <p className="mt-1 text-xs text-slate-500">{item.status === 'pending' ? 'Awaiting review' : `Request ${item.status}`} · {item.read_at ? 'Read' : 'Unread'}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"><Link to={notificationTarget(item)} aria-disabled={busyId !== null} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void update(item, true, true) }} className="text-xs font-semibold text-teal-800 underline underline-offset-2">View join request</Link><button type="button" disabled={busyId !== null} onClick={() => void update(item, !item.read_at)} className="text-xs font-medium text-slate-600 underline underline-offset-2 disabled:opacity-50">{busyId === item.id ? 'Saving…' : item.read_at ? 'Mark unread' : 'Mark read'}</button></div>
        </li>)}
      </ul>}
      {feed.isSuccess && (page > 1 || feed.data.has_more) && <div className="mt-4 flex items-center justify-between gap-2"><Button variant="secondary" disabled={page === 1 || feed.isFetching || busyId !== null} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-xs text-slate-500">Page {page}</span><Button variant="secondary" disabled={!feed.data.has_more || feed.isFetching || busyId !== null} onClick={() => setPage(value => value + 1)}>Next</Button></div>}
    </section>}
  </div>
}
