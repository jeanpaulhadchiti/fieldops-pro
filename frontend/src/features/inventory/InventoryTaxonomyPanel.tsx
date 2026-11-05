import { useState } from 'react'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import ConfirmationDialog from '../../components/ui/ConfirmationDialog'
import { getErrorMessage } from '../../services/api'
import type { InventoryCategoryRecord, StorageLocationRecord } from '../../types/api'
import { deleteInventoryCategory, deleteStorageLocation } from './api'
import InventoryTaxonomyForm, { type InventoryTaxonomyKind } from './InventoryTaxonomyForm'
import { useInventoryCategories, useStorageLocations } from './queries'
import { useInventoryMutation } from './useInventoryMutation'
import { useInventoryWriteAccess } from './useInventoryWriteAccess'

type TaxonomyRecord = InventoryCategoryRecord | StorageLocationRecord

export default function InventoryTaxonomyPanel({ organizationId, kind, canManage }: { organizationId: string; kind: InventoryTaxonomyKind; canManage: boolean }) {
  const canWrite = useInventoryWriteAccess(organizationId) && canManage
  const categories = useInventoryCategories(kind === 'categories' ? organizationId : undefined)
  const locations = useStorageLocations(kind === 'locations' ? organizationId : undefined)
  const query = kind === 'categories' ? categories : locations
  const [editing, setEditing] = useState<TaxonomyRecord | null>(null)
  const [deleting, setDeleting] = useState<TaxonomyRecord | null>(null)
  const [notice, setNotice] = useState('')
  const label = kind === 'categories' ? 'category' : 'storage location'
  const title = kind === 'categories' ? 'Equipment Categories' : 'Storage Locations'
  const remove = useInventoryMutation<null, string>({
    organizationId,
    mutationFn: id => kind === 'categories' ? deleteInventoryCategory(id, organizationId) : deleteStorageLocation(id, organizationId),
    onSuccess: (_data, id) => { setDeleting(null); setEditing(current => current?.id === id ? null : current); setNotice(`${kind === 'categories' ? 'Category' : 'Storage location'} deleted.`) },
  })

  return <section aria-label={title} className="min-w-0 space-y-4">
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 p-6"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{kind === 'categories' ? 'Organize equipment by category.' : "Manage where your organization's equipment is stored."} Only unused {kind === 'categories' ? 'categories' : 'locations'} can be deleted.</p></div>
      {notice && <p role="status" className="m-5 rounded-lg bg-teal-50 p-3 text-sm text-teal-700">{notice}</p>}
      {query.isPending ? <LoadingState label={`Loading ${kind === 'categories' ? 'categories' : 'storage locations'}…`} /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !query.data.length ? <EmptyState title={`No ${kind === 'categories' ? 'categories' : 'storage locations'} yet`} description={`New ${kind === 'categories' ? 'categories' : 'storage locations'} will appear here.`} /> : <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4 p-6">
        {query.data.map(record => <li key={record.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="break-words font-semibold text-slate-900">{record.name}</h3><p className="mt-2 break-words text-sm text-slate-500">{record.description || 'No description provided'}</p>
          {canWrite && <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" aria-label={`Edit ${label} ${record.name}`} disabled={remove.isPending} onClick={() => { setEditing(record); setNotice('') }}>Edit</Button><Button variant="danger" aria-label={`Delete ${label} ${record.name}`} disabled={remove.isPending} onClick={() => { remove.reset(); setDeleting(record); setNotice('') }}>Delete</Button></div>}
        </li>)}
      </ul>}
    </Card>
    {canWrite && <InventoryTaxonomyForm key={editing?.id ?? `create-${kind}`} organizationId={organizationId} kind={kind} record={editing ?? undefined} onClose={editing ? () => setEditing(null) : undefined} disabled={remove.isPending} />}
    <ConfirmationDialog open={!!deleting && canWrite} title={`Delete ${label}?`} description={deleting ? `Delete "${deleting.name}"? Equipment still assigned to this ${label}, including archived equipment, must be unassigned before it can be deleted.` : undefined} confirmLabel={`Delete ${label}`} danger busy={remove.isPending} confirmDisabled={!canWrite} onCancel={() => { setDeleting(null); remove.reset() }} onConfirm={() => { if (deleting && canWrite) remove.mutate(deleting.id) }}>
      {remove.isError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{getErrorMessage(remove.error)}</p>}
    </ConfirmationDialog>
  </section>
}
