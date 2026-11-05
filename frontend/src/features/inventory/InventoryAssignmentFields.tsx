import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { Button, Field } from '../../components/ui'
import { inputClassName } from '../../components/ui/styles'
import { getErrorMessage } from '../../services/api'
import type { InventoryCategoryRecord, StorageLocationRecord } from '../../types/api'
import type { EquipmentFormValues } from './formSchemas'

interface AssignmentQuery {
  data?: (InventoryCategoryRecord | StorageLocationRecord)[]
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => Promise<unknown>
}

interface Props {
  prefix: string
  register: UseFormRegister<EquipmentFormValues>
  errors: FieldErrors<EquipmentFormValues>
  categories: AssignmentQuery
  locations: AssignmentQuery
  categoryId?: string | null
  locationId?: string | null
}

export default function InventoryAssignmentFields({ prefix, register, errors, categories, locations, categoryId, locationId }: Props) {
  return <>{([
    { field: 'category_id', label: 'Category', empty: 'Uncategorized', query: categories, selected: categoryId },
    { field: 'location_id', label: 'Storage Location', empty: 'No location', query: locations, selected: locationId },
  ] as const).map(({ field, label, empty, query, selected }) => {
    const id = `${prefix}-${field}`
    return <Field key={field} htmlFor={id} label={label} error={errors[field]?.message} hint={query.isPending ? `Loading ${label.toLowerCase()} options…` : !query.isError && !query.data?.length ? `No ${field === 'category_id' ? 'categories' : 'storage locations'} yet. You can leave this unassigned.` : undefined}>
      <select id={id} className={inputClassName} disabled={query.isPending || query.isError} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${id}-error` : query.isPending || (!query.isError && !query.data?.length) ? `${id}-hint` : undefined} {...register(field)}>
        <option value="">{empty}</option>
        {selected && !query.data?.some(record => record.id === selected) && <option value={selected}>Current {label.toLowerCase()} (unavailable)</option>}
        {query.data?.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}
      </select>
      {query.isError && <div role="alert" className="mt-2 text-sm text-rose-700"><p>Unable to load {label.toLowerCase()} options. {getErrorMessage(query.error)}</p><Button variant="secondary" className="mt-2" onClick={() => void query.refetch()}>Retry {label.toLowerCase()} options</Button></div>}
    </Field>
  })}</>
}
