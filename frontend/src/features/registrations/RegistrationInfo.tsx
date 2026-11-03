import { CheckCircle2 } from 'lucide-react'
import { StatusBadge } from '../../components/ui'
import { formatEventDate } from '../events/format'
import type { Registration } from './types'

export default function RegistrationInfo({ registration }: { registration: Registration }) {
  return <dl className="grid gap-4 text-sm sm:grid-cols-2">
    <div><dt className="text-xs font-medium text-slate-500">Registration status</dt><dd className="mt-1.5"><StatusBadge status={registration.status} /></dd></div>
    <div><dt className="text-xs font-medium text-slate-500">Attendance</dt><dd className="mt-1.5 text-slate-700">{registration.attended_at ? <span className="inline-flex items-start gap-1.5"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-teal-700" aria-hidden="true" /><time dateTime={registration.attended_at}>{formatEventDate(registration.attended_at)}</time></span> : 'Not marked attended'}</dd></div>
    <div><dt className="text-xs font-medium text-slate-500">Fee requirement</dt><dd className="mt-1.5 text-slate-700">{registration.fee_required ? 'Fee required' : 'No fee required'}</dd></div>
    <div><dt className="text-xs font-medium text-slate-500">Payment status</dt><dd className="mt-1.5 text-slate-700">{registration.payment_status ? registration.payment_status.charAt(0).toUpperCase() + registration.payment_status.slice(1) : 'Not applicable'}</dd></div>
    <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Registered on</dt><dd className="mt-1.5 text-slate-700"><time dateTime={registration.created_at}>{formatEventDate(registration.created_at)}</time></dd></div>
  </dl>
}
