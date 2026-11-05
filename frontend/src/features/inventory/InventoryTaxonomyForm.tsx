import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Card, Field } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { getErrorMessage } from '../../services/api'
import type { InventoryCategoryRecord, StorageLocationRecord } from '../../types/api'
import { createInventoryCategory, createStorageLocation, updateInventoryCategory, updateStorageLocation } from './api'
import { taxonomyFormSchema, type TaxonomyFormValues } from './formSchemas'
import { useInventoryMutation } from './useInventoryMutation'
import { useInventoryPanelFocus } from './useInventoryPanelFocus'
import { useInventoryWriteAccess } from './useInventoryWriteAccess'

export type InventoryTaxonomyKind = 'categories' | 'locations'
type TaxonomyRecord = InventoryCategoryRecord | StorageLocationRecord

interface Props {
  organizationId: string
  kind: InventoryTaxonomyKind
  record?: TaxonomyRecord
  onClose?: () => void
  disabled?: boolean
}

export default function InventoryTaxonomyForm({ organizationId, kind, record, onClose, disabled = false }: Props) {
  const heading = useInventoryPanelFocus(Boolean(record))
  const canWrite = useInventoryWriteAccess(organizationId)
  const label = kind === 'categories' ? 'Category' : 'Storage Location'
  const prefix = `${kind === 'categories' ? 'category' : 'location'}${record ? '-edit' : ''}`
  const { register, handleSubmit, reset, formState: { errors } } = useForm<TaxonomyFormValues>({ resolver: zodResolver(taxonomyFormSchema), defaultValues: { name: record?.name ?? '', description: record?.description ?? '' } })
  const save = useInventoryMutation<TaxonomyRecord, TaxonomyFormValues>({
    organizationId,
    mutationFn: values => {
      const payload = { name: values.name, description: values.description || null }
      if (record) return kind === 'categories' ? updateInventoryCategory(record.id, organizationId, payload) : updateStorageLocation(record.id, organizationId, payload)
      return kind === 'categories' ? createInventoryCategory({ organization_id: organizationId, ...payload }) : createStorageLocation({ organization_id: organizationId, ...payload })
    },
    onSuccess: () => { if (record) onClose?.(); else reset() },
  })

  return <section data-inventory-panel><Card className="p-6">
    <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 focus:outline-none">{record ? 'Edit' : 'Create'} {label}</h3>
    <p className="mt-1 text-sm text-slate-500">{record ? `Update ${record.name}.` : kind === 'categories' ? 'Organize your equipment into categories.' : 'Add a place to store your equipment.'}</p>
    {save.isSuccess && !record && <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-700">{label} created successfully!</p>}
    {save.isError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{getErrorMessage(save.error)}</p>}
    {!canWrite && <p role="alert" className="mt-4 text-sm text-rose-700">Changes require an active Owner or Admin in an active workspace.</p>}
    <form noValidate className="mt-5 space-y-5" onSubmit={handleSubmit(values => { if (canWrite && !disabled) save.mutate(values) })}>
      <fieldset disabled={!canWrite || disabled || save.isPending} className="space-y-5">
        <legend className="sr-only">{label} information</legend>
        <Field htmlFor={`${prefix}-name`} label={`${label} Name *`} error={errors.name?.message}>
          <input id={`${prefix}-name`} className={inputClassName} maxLength={100} aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? `${prefix}-name-error` : undefined} {...register('name')} />
        </Field>
        <Field htmlFor={`${prefix}-description`} label="Description" error={errors.description?.message}>
          <textarea id={`${prefix}-description`} className={inputClassName} rows={3} maxLength={500} aria-invalid={!!errors.description} aria-describedby={errors.description ? `${prefix}-description-error` : undefined} {...register('description')} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-3">
        {onClose && <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>}
        <Button type="submit" busy={save.isPending} disabled={!canWrite || disabled || save.isPending}>{save.isPending ? 'Saving…' : record ? `Save ${label}` : `Create ${label}`}</Button>
      </div>
    </form>
  </Card></section>
}
