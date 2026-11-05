import { useState, useSyncExternalStore } from 'react'
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader } from '../components/ui'
import ConfirmationDialog from '../components/ui/ConfirmationDialog'
import { inputClassName } from '../components/ui/styles'
import { archiveInventoryItem, restoreInventoryItem } from '../features/inventory/api'
import CreateInventoryItemForm from '../features/inventory/CreateInventoryItemForm'
import EditInventoryItemForm from '../features/inventory/EditInventoryItemForm'
import InventoryMovementsPanel from '../features/inventory/InventoryMovementsPanel'
import InventoryTaxonomyPanel from '../features/inventory/InventoryTaxonomyPanel'
import { useInventoryCategories, useInventoryItems, useStorageLocations } from '../features/inventory/queries'
import { quantityCents } from '../features/inventory/quantity'
import { useInventoryMutation } from '../features/inventory/useInventoryMutation'
import { useOrganization } from '../features/organizations/useOrganization'
import { getErrorMessage } from '../services/api'
import { getSession, subscribeSession } from '../services/session'

export default function InventoryPage() {
  const scope = useOrganization()
  const session = useSyncExternalStore(subscribeSession, getSession)
  if (scope.isLoading) return <LoadingState />
  if (scope.error) return <ErrorState error={scope.error} onRetry={scope.retry} />
  if (!scope.organization) return <EmptyState title="Select an organization" description="Choose your workspace to view inventory." />
  const canManage = !scope.organization.archived_at && scope.membership?.status === 'active' && ['Owner', 'Admin'].includes(scope.membership.role)
  return <InventoryWorkspace key={`${session.version}:${scope.organization.id}`} organizationId={scope.organization.id} organizationName={scope.organization.name} canManage={canManage} />
}

function InventoryWorkspace({ organizationId, organizationName, canManage }: { organizationId: string; organizationName: string; canManage: boolean }) {
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [lowStock, setLowStock] = useState(false)
  const [page, setPage] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [stockId, setStockId] = useState<string | null>(null)
  const [confirmationId, setConfirmationId] = useState<string | null>(null)
  const inventory = useInventoryItems(organizationId, archived)
  const categories = useInventoryCategories(organizationId)
  const locations = useStorageLocations(organizationId)
  const items = inventory.data ?? []
  const editingItem = items.find(item => item.id === editingId)
  const stockItem = items.find(item => item.id === stockId)
  const confirmationItem = items.find(item => item.id === confirmationId)
  const lifecycle = useInventoryMutation({
    organizationId,
    mutationFn: ({ id, restore }: { id: string; restore: boolean }) => restore ? restoreInventoryItem(id, organizationId) : archiveInventoryItem(id, organizationId),
    onSuccess: () => { setConfirmationId(null); setEditingId(null) },
  })
  const matches = items.filter(item => {
    const needle = search.trim().toLocaleLowerCase()
    return (!needle || `${item.name} ${item.sku ?? ''}`.toLocaleLowerCase().includes(needle)) &&
      (!categoryId || (categoryId === 'none' ? item.category_id === null : item.category_id === categoryId)) &&
      (!locationId || (locationId === 'none' ? item.location_id === null : item.location_id === locationId)) &&
      (!lowStock || quantityCents(item.current_quantity) < quantityCents(item.minimum_quantity))
  })
  const lastPage = Math.max(0, Math.ceil(matches.length / 50) - 1)
  const currentPage = Math.min(page, lastPage)
  const visible = matches.slice(currentPage * 50, (currentPage + 1) * 50)

  function changeView(value: string) {
    if (lifecycle.isPending) return
    setArchived(value === 'archived'); setPage(0); setEditingId(null); setStockId(null); setConfirmationId(null); lifecycle.reset()
  }

  return <div className="space-y-7">
    <PageHeader eyebrow="Equipment and supplies" title="Inventory" description={`Manage equipment and supplies for ${organizationName}.`} />
    {inventory.isSuccess && !inventory.isError && <section aria-label="Inventory statistics" className="grid gap-4 sm:grid-cols-3">
      {[
        [archived ? 'Archived equipment total' : 'Active equipment total', items.length],
        ['In stock', items.filter(item => quantityCents(item.current_quantity) > 0).length],
        ['Low-stock alerts', items.filter(item => quantityCents(item.current_quantity) < quantityCents(item.minimum_quantity)).length],
      ].map(([label, count]) => <Card key={label} className="p-5"><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-3xl font-bold text-slate-900">{count}</p></Card>)}
    </section>}
    <Card className="overflow-hidden">
      <div className="space-y-5 border-b border-slate-100 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-900">{archived ? 'Archived Equipment' : 'Inventory Items'}</h2>
          <Button variant="secondary" onClick={() => void inventory.refetch()} busy={inventory.isFetching}>Refresh inventory</Button></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field htmlFor="inventory-search" label="Search equipment"><input id="inventory-search" type="search" placeholder="Name or SKU" className={inputClassName} value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></Field>
          <Field htmlFor="inventory-category-filter" label="Category filter"><select id="inventory-category-filter" className={inputClassName} value={categoryId} onChange={event => { setCategoryId(event.target.value); setPage(0) }} disabled={!categories.isSuccess}>
            <option value="">All categories</option><option value="none">Uncategorized</option>{categoryId && categoryId !== 'none' && !categories.data?.some(category => category.id === categoryId) && <option value={categoryId}>Selected category unavailable</option>}{categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></Field>
          <Field htmlFor="inventory-location-filter" label="Location filter"><select id="inventory-location-filter" className={inputClassName} value={locationId} onChange={event => { setLocationId(event.target.value); setPage(0) }} disabled={!locations.isSuccess}>
            <option value="">All locations</option><option value="none">No location</option>{locationId && locationId !== 'none' && !locations.data?.some(location => location.id === locationId) && <option value={locationId}>Selected location unavailable</option>}{locations.data?.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select></Field>
          <Field htmlFor="inventory-view" label="Equipment view"><select id="inventory-view" className={inputClassName} disabled={lifecycle.isPending} value={archived ? 'archived' : 'active'} onChange={event => changeView(event.target.value)}><option value="active">Active equipment</option><option value="archived">Archived equipment</option></select></Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={lowStock} onChange={event => { setLowStock(event.target.checked); setPage(0) }} />Low stock only</label>
          <Button variant="ghost" onClick={() => { setSearch(''); setCategoryId(''); setLocationId(''); setLowStock(false); setPage(0) }}>Clear filters</Button></div>
        {categories.isPending && <p role="status" className="text-sm text-slate-500">Loading category filters…</p>}
        {locations.isPending && <p role="status" className="text-sm text-slate-500">Loading location filters…</p>}
        {categories.isError && <ErrorState error={categories.error} onRetry={() => void categories.refetch()} title="Unable to load category filters" />}
        {locations.isError && <ErrorState error={locations.error} onRetry={() => void locations.refetch()} title="Unable to load location filters" />}
      </div>
      {inventory.isPending ? <LoadingState label="Loading complete inventory…" /> : inventory.isError ? <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} /> : matches.length === 0 ?
        <EmptyState title={items.length === 0 ? (archived ? 'No archived equipment' : 'No inventory items yet') : 'No matching equipment'} description={items.length === 0 ? 'Equipment for this view will appear here.' : 'Change or clear the filters to see more equipment.'} /> : <>
          <ul className="divide-y divide-slate-100" aria-label="Equipment list">{visible.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0 flex-1"><h3 className="break-words font-semibold text-slate-900">{item.name}</h3><p className="mt-1 break-words text-sm text-slate-500">{item.sku || 'No SKU'} · {item.item_type === 'reusable' ? 'Reusable' : 'Consumable'}</p>
              <p className="mt-1 break-words text-xs text-slate-500">{item.category_id ? categories.data?.find(category => category.id === item.category_id)?.name ?? 'Category unavailable' : 'Uncategorized'} · {item.location_id ? locations.data?.find(location => location.id === item.location_id)?.name ?? 'Location unavailable' : 'No location'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3"><p className="text-sm font-semibold text-slate-700">{item.current_quantity} {item.unit}<span className="block text-xs font-normal text-slate-500">Minimum {item.minimum_quantity}</span>{quantityCents(item.current_quantity) < quantityCents(item.minimum_quantity) && <span className="block text-xs text-rose-700">Low stock</span>}</p>
              <Button variant="secondary" aria-label={`Stock & history ${item.name}`} onClick={() => { setStockId(item.id); setEditingId(null) }}>Stock &amp; history</Button>
              {canManage && <>
                {!archived && <Button variant="ghost" aria-label={`Edit ${item.name}`} onClick={() => { setEditingId(item.id); setStockId(null) }} disabled={lifecycle.isPending}>Edit</Button>}
                <Button variant={archived ? 'secondary' : 'danger'} aria-label={`${archived ? 'Restore' : 'Archive'} ${item.name}`} disabled={lifecycle.isPending || (!archived && quantityCents(item.current_quantity) !== 0)} title={!archived && quantityCents(item.current_quantity) !== 0 ? 'Equipment must have zero stock before archiving.' : undefined} onClick={() => { lifecycle.reset(); setConfirmationId(item.id) }}>{archived ? 'Restore' : 'Archive'}</Button>
              </>}
            </div>
          </li>)}</ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5"><p role="status" className="text-sm text-slate-500">{matches.length} matching of {items.length} {archived ? 'archived' : 'active'} equipment · Page {currentPage + 1} of {lastPage + 1}</p>
            <div className="flex gap-2"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
          </div>
        </>}
    </Card>
    {lifecycle.isSuccess && <p role="status" className="text-sm text-teal-700">Equipment {lifecycle.variables?.restore ? 'restored' : 'archived'}.</p>}
    {lifecycle.isError && !confirmationItem && <p role="alert" className="text-sm text-rose-700">{getErrorMessage(lifecycle.error)}</p>}
    <ConfirmationDialog open={Boolean(confirmationItem && canManage)} title={archived ? 'Restore equipment' : 'Archive equipment'} description={`${archived ? 'Restore' : 'Archive'} "${confirmationItem?.name ?? ''}"? ${archived ? 'It will return to active inventory.' : 'Equipment must have zero stock. Its movement history will be preserved.'}`} confirmLabel={archived ? 'Restore equipment' : 'Archive equipment'} danger={!archived} busy={lifecycle.isPending} confirmDisabled={!confirmationItem || (!archived && quantityCents(confirmationItem.current_quantity) !== 0)} onCancel={() => { setConfirmationId(null); lifecycle.reset() }} onConfirm={() => { if (confirmationItem && canManage) lifecycle.mutate({ id: confirmationItem.id, restore: archived }) }} >
      {lifecycle.isError && <p role="alert" className="text-sm text-rose-700">{getErrorMessage(lifecycle.error)}</p>}
    </ConfirmationDialog>
    {stockItem && <InventoryMovementsPanel key={stockItem.id} item={stockItem} canManage={canManage} onClose={() => setStockId(null)} />}
    {canManage && editingItem && !archived && <EditInventoryItemForm key={editingItem.id} item={editingItem} onClose={() => setEditingId(null)} />}
    {canManage && <CreateInventoryItemForm organizationId={organizationId} />}
    <div className="grid gap-7 xl:grid-cols-2">
      <InventoryTaxonomyPanel organizationId={organizationId} kind="categories" canManage={canManage} />
      <InventoryTaxonomyPanel organizationId={organizationId} kind="locations" canManage={canManage} />
    </div>
  </div>
}

