import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AlertCircle, CalendarDays, LoaderCircle, RefreshCw } from 'lucide-react'
import { getErrorMessage } from '../../services/api'
import { buttonClassName } from './styles'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  busy?: boolean
}

export function Button({ children, variant = 'primary', busy, disabled, className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`${buttonClassName(variant)} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
    {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{children}
  </button>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-xs ${className}`}>{children}</div>
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
    <div className="min-w-0">
      {eyebrow && <p className="mb-2 text-xs font-bold tracking-[0.16em] text-teal-700 uppercase">{eyebrow}</p>}
      <h1 className="break-words text-3xl font-bold tracking-tight text-slate-900 sm:text-[2rem]">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
}

export function LoadingState({ label = 'Loading your workspace…' }: { label?: string }) {
  return <div role="status" className="flex min-h-44 flex-col items-center justify-center gap-3 p-8 text-sm text-slate-500">
    <LoaderCircle className="size-7 animate-spin text-teal-700" aria-hidden="true" />{label}
  </div>
}

export function ErrorState({ error, onRetry, title = 'We couldn’t load this information' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6">
    <div className="flex gap-3"><AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" /><div>
      <h2 className="font-semibold text-red-900">{title}</h2><p className="mt-1 text-sm leading-6 text-red-800">{getErrorMessage(error)}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry} className="mt-4"><RefreshCw className="size-4" aria-hidden="true" />Try again</Button>}
    </div></div>
  </div>
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
    <div className="mb-4 rounded-2xl bg-teal-50 p-4 text-teal-700"><CalendarDays className="size-7" aria-hidden="true" /></div>
    <h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    planned: 'bg-blue-50 text-blue-700 ring-blue-100', active: 'bg-teal-50 text-teal-700 ring-teal-100',
    completed: 'bg-slate-100 text-slate-600 ring-slate-200', cancelled: 'bg-red-50 text-red-700 ring-red-100',
    todo: 'bg-slate-100 text-slate-600 ring-slate-200', in_progress: 'bg-amber-50 text-amber-800 ring-amber-100',
    done: 'bg-teal-50 text-teal-700 ring-teal-100',
  }
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${colors[status] || 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{status.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())}
  </span>
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return <div><label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor={htmlFor}>{label}</label>
    {children}{hint && <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p>}
    {error && <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
  </div>
}
