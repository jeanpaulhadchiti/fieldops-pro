import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, EmptyState, ErrorState, Field, LoadingState } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { getErrorMessage } from '../../services/api'
import type { InventoryItemRecord, InventoryMovementCreate } from '../../types/api'
import { createInventoryMovement } from './api'
import { movementDelta, movementSchema, stockConflict, type MovementValues } from './movementSchema'
import { useInventoryMovements } from './queries'
import { quantityCents } from './quantity'
import { useInventoryMutation } from './useInventoryMutation'
import { useInventoryPanelFocus } from './useInventoryPanelFocus'

interface Props { item: InventoryItemRecord; canManage: boolean; onClose: () => void }

export default function InventoryMovementsPanel({ item, canManage, onClose }: Props) {
  const heading = useInventoryPanelFocus()
  const history = useInventoryMovements(item.organization_id, item.id)
  const [visibleRows, setVisibleRows] = useState(50)
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<MovementValues>({
    resolver: zodResolver(movementSchema), defaultValues: { movement_type: 'receive', quantity: '', notes: '' },
  })
  const mutation = useInventoryMutation({
    organizationId: item.organization_id,
    mutationFn: (payload: InventoryMovementCreate) => createInventoryMovement(payload),
    onSuccess: () => { reset(); setVisibleRows(50) },
  })
  const canWrite = canManage && !item.archived
  const openingAllowed = history.isSuccess && history.data.length === 0 && quantityCents(item.current_quantity) === 0

  function submit(values: MovementValues) {
    if (!canWrite || !history.isSuccess || history.isFetching || mutation.isPending) return
    const conflict = stockConflict(values, item.current_quantity, history.data.length > 0)
    if (conflict) { setError('quantity', { message: conflict }); return }
    mutation.mutate({ organization_id: item.organization_id, item_id: item.id, movement_type: values.movement_type,
      quantity_delta: movementDelta(values), notes: values.notes || null })
  }

  return <section data-inventory-panel><Card className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-6">
      <div className="min-w-0"><h2 ref={heading} tabIndex={-1} className="break-words text-lg font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-teal-500">Stock &amp; history: {item.name}</h2>
        <p className="mt-1 text-sm text-slate-600">Current stock: {item.current_quantity} {item.unit}</p></div>
      <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Close stock &amp; history</Button>
    </div>
    {canWrite && <form className="space-y-5 p-6" noValidate onSubmit={handleSubmit(submit)}>
      <p className="text-sm text-slate-500">Receive, return and opening add stock. Issue subtracts the positive amount entered. Adjustments accept a signed change and require a reason.</p>
      {mutation.isSuccess && <p role="status" className="text-sm text-teal-700">Stock movement recorded.</p>}
      {mutation.isError && <p role="alert" className="text-sm text-rose-700">{getErrorMessage(mutation.error)}</p>}
      <fieldset disabled={mutation.isPending || !history.isSuccess || history.isFetching} className="grid gap-5 sm:grid-cols-2">
        <legend className="sr-only">Record a stock movement</legend>
        <Field htmlFor="movement-type" label="Movement type" error={errors.movement_type?.message}>
          <select id="movement-type" className={inputClassName} aria-invalid={Boolean(errors.movement_type)} aria-describedby={errors.movement_type ? 'movement-type-error' : undefined} {...register('movement_type')}>
            <option value="receive">Receive</option><option value="issue">Issue</option><option value="return">Return</option>
            <option value="adjustment">Adjustment</option><option value="opening" disabled={!openingAllowed}>Opening stock</option>
          </select>
        </Field>
        <Field htmlFor="movement-quantity" label="Quantity" error={errors.quantity?.message} hint="Up to 2 decimal places; zero is not allowed.">
          <input id="movement-quantity" className={inputClassName} inputMode="decimal" aria-invalid={Boolean(errors.quantity)} aria-describedby={errors.quantity ? 'movement-quantity-error' : 'movement-quantity-hint'} {...register('quantity')} />
        </Field>
        <div className="sm:col-span-2"><Field htmlFor="movement-notes" label="Notes / adjustment reason" error={errors.notes?.message}>
          <textarea id="movement-notes" rows={2} maxLength={1000} className={inputClassName} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? 'movement-notes-error' : undefined} {...register('notes')} />
        </Field></div>
      </fieldset>
      <Button type="submit" busy={mutation.isPending} disabled={!history.isSuccess || history.isFetching}>Record movement</Button>
    </form>}
    {history.isPending ? <LoadingState label="Loading movement history…" /> : history.isError ?
      <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : history.data.length === 0 ?
      <EmptyState title="No stock movements yet" description="The first stock change will start this item's audit history." /> : <>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="p-4 text-left font-semibold text-slate-700">Movement history for {item.name}</caption>
          <thead className="border-y border-slate-100 bg-slate-50 text-slate-600"><tr>
            {['Sequence / time', 'Type', 'Before', 'Change', 'After', 'Actor identifier', 'Notes'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">{history.data.slice(0, visibleRows).map(movement => <tr key={movement.id}>
            <th scope="row" className="whitespace-nowrap px-4 py-3 font-normal">#{movement.sequence_number}<br /><time dateTime={movement.created_at}>{new Date(movement.created_at).toLocaleString()}</time></th>
            <td className="px-4 py-3 capitalize">{movement.movement_type}</td>
            <td className="px-4 py-3 tabular-nums">{movement.quantity_before}</td><td className="px-4 py-3 tabular-nums">{movement.quantity_delta}</td><td className="px-4 py-3 tabular-nums">{movement.quantity_after}</td>
            <td className="max-w-64 break-all px-4 py-3 text-xs">{movement.actor_id ?? 'Unavailable'}</td><td className="min-w-40 whitespace-pre-wrap break-words px-4 py-3">{movement.notes ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-xs text-slate-500">Showing {Math.min(visibleRows, history.data.length)} of {history.data.length} movements, newest sequence first.</p>
          {visibleRows < history.data.length && <Button variant="secondary" onClick={() => setVisibleRows(rows => rows + 50)}>Show more movements</Button>}</div>
      </>}
  </Card></section>
}
