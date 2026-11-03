import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './index'

interface Props {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
  confirmDisabled?: boolean
}

/** Native modal semantics provide focus trapping, inert background, and restoration. */
export default function ConfirmationDialog({ open, title, description, children, confirmLabel, onConfirm, onCancel, busy = false, danger = false, confirmDisabled = false }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const element = dialog.current
    if (open && !element?.open) element?.showModal()
    else if (!open && element?.open) element.close()
    return () => { if (element?.open) element.close() }
  }, [open])

  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} onCancel={event => { event.preventDefault(); if (!busy) onCancel() }} className="fixed inset-0 m-auto max-h-[90svh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50">
    <h2 id={`${id}-title`} className="break-words text-lg font-semibold">{title}</h2>
    {description && <p id={`${id}-description`} className="mt-3 text-sm leading-6 text-slate-600">{description}</p>}
    {children && <div className="mt-4">{children}</div>}
    <div className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="secondary" onClick={onCancel} disabled={busy}>Go back</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy} disabled={confirmDisabled}>{confirmLabel}</Button></div>
  </dialog>
}
