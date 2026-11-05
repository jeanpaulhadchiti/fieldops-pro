import { zodResolver } from '@hookform/resolvers/zod'
import { PackagePlus, Save } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Button, Card, Field } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { getErrorMessage } from '../../services/api'
import type { InventoryItemRecord } from '../../types/api'
import { createInventoryItem, updateInventoryItem } from './api'
import { equipmentFormSchema, type EquipmentFormValues } from './formSchemas'
import InventoryAssignmentFields from './InventoryAssignmentFields'
import { useInventoryCategories, useStorageLocations } from './queries'
import { useInventoryMutation } from './useInventoryMutation'
import { useInventoryPanelFocus } from './useInventoryPanelFocus'
import { useInventoryWriteAccess } from './useInventoryWriteAccess'

interface Props {
  organizationId: string
  item?: InventoryItemRecord
  onClose?: () => void
}

export default function InventoryItemForm({ organizationId, item, onClose }: Props) {
  const heading = useInventoryPanelFocus(Boolean(item))
  const canWrite = useInventoryWriteAccess(organizationId)
  const categories = useInventoryCategories(organizationId)
  const locations = useStorageLocations(organizationId)
  const prefix = item ? 'edit' : 'item'
  const { register, handleSubmit, reset, formState: { errors } } = useForm<EquipmentFormValues>({
    resolver: zodResolver(equipmentFormSchema),
    defaultValues: {
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      unit: item?.unit ?? 'piece',
      item_type: item?.item_type ?? 'reusable',
      minimum_quantity: item?.minimum_quantity ?? '0',
      category_id: item?.category_id ?? '',
      location_id: item?.location_id ?? '',
    },
  })
  const save = useInventoryMutation<InventoryItemRecord, EquipmentFormValues>({
    organizationId,
    mutationFn: values => {
      const payload = { ...values, sku: values.sku || null, category_id: values.category_id || null, location_id: values.location_id || null }
      return item ? updateInventoryItem(item.id, organizationId, payload) : createInventoryItem({ organization_id: organizationId, ...payload })
    },
    onSuccess: () => { if (item) onClose?.(); else reset() },
  })
  const optionsReady = !categories.isPending && !categories.isError && !locations.isPending && !locations.isError

  return <section data-inventory-panel><Card className="p-6">
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-slate-900 focus:outline-none">{item ? 'Edit Equipment' : 'Add Equipment'}</h2>
    <p className="mt-1 text-sm text-slate-500">{item ? `Update the details of ${item.name}.` : 'Register new equipment or supplies. New equipment starts at zero stock; record stock through movements.'}</p>
    {save.isSuccess && !item && <p role="status" className="mt-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-700">Equipment created successfully!</p>}
    {save.isError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{getErrorMessage(save.error)}</p>}
    {!canWrite && <p role="alert" className="mt-4 text-sm text-rose-700">Equipment changes require an active Owner or Admin in an active workspace.</p>}
    <form noValidate onSubmit={handleSubmit(values => { if (canWrite && optionsReady) save.mutate(values) })} className="mt-6 space-y-5">
      <fieldset disabled={save.isPending || !canWrite} className="grid gap-5 sm:grid-cols-2">
        <legend className="sr-only">{item ? 'Edit equipment details' : 'Equipment information'}</legend>
        <Field htmlFor={`${prefix}-name`} label="Equipment Name *" error={errors.name?.message}>
          <input id={`${prefix}-name`} className={inputClassName} placeholder="Camping Tent" maxLength={150} aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? `${prefix}-name-error` : undefined} {...register('name')} />
        </Field>
        <Field htmlFor={`${prefix}-sku`} label="SKU" error={errors.sku?.message}>
          <input id={`${prefix}-sku`} className={inputClassName} placeholder="TENT-001" maxLength={50} aria-invalid={!!errors.sku} aria-describedby={errors.sku ? `${prefix}-sku-error` : undefined} {...register('sku')} />
        </Field>
        <Field htmlFor={`${prefix}-type`} label="Equipment Type *" error={errors.item_type?.message}>
          <select id={`${prefix}-type`} className={inputClassName} aria-required="true" aria-invalid={!!errors.item_type} aria-describedby={errors.item_type ? `${prefix}-type-error` : undefined} {...register('item_type')}><option value="reusable">Reusable</option><option value="consumable">Consumable</option></select>
        </Field>
        <Field htmlFor={`${prefix}-unit`} label="Unit *" error={errors.unit?.message}>
          <input id={`${prefix}-unit`} className={inputClassName} maxLength={20} aria-required="true" aria-invalid={!!errors.unit} aria-describedby={errors.unit ? `${prefix}-unit-error` : undefined} {...register('unit')} />
        </Field>
        <Field htmlFor={`${prefix}-minimum`} label="Minimum Stock *" error={errors.minimum_quantity?.message}>
          <input id={`${prefix}-minimum`} type="text" inputMode="decimal" className={inputClassName} aria-required="true" aria-invalid={!!errors.minimum_quantity} aria-describedby={errors.minimum_quantity ? `${prefix}-minimum-error` : undefined} {...register('minimum_quantity')} />
        </Field>
        <InventoryAssignmentFields prefix={prefix} register={register} errors={errors} categories={categories} locations={locations} categoryId={item?.category_id} locationId={item?.location_id} />
      </fieldset>
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
        {onClose && <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>}
        <Button type="submit" busy={save.isPending} disabled={!canWrite || !optionsReady || save.isPending}>{item ? <Save size={17} aria-hidden="true" /> : <PackagePlus size={17} aria-hidden="true" />}{save.isPending ? 'Saving…' : item ? 'Save Changes' : 'Create Equipment'}</Button>
      </div>
    </form>
  </Card></section>
}
