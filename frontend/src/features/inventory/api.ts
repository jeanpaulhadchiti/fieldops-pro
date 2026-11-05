import { apiRequest } from '../../services/api'
import { getSession } from '../../services/session'
import type {
  InventoryCategoryCreate, InventoryCategoryRecord, InventoryItemCreate,
  InventoryItemRecord, InventoryItemUpdate, InventoryMovementCreate,
  InventoryMovementRecord, InventoryTaxonomyUpdate, StorageLocationCreate,
  StorageLocationRecord,
} from '../../types/api'

const base = '/api/v1/inventory'
const scopedPath = (resource: string, id: string, organizationId: string) =>
  `${base}/${resource}/${encodeURIComponent(id)}?${new URLSearchParams({ organization_id: organizationId })}`

function scopedRecords<T extends { organization_id: string }>(records: T[], organizationId: string): T[] {
  if (!Array.isArray(records) || records.some(record => record.organization_id !== organizationId)) {
    throw new Error('The inventory response did not match your workspace. Please reload inventory.')
  }
  return records
}

/** Do not expose partial lists as complete counts or switch accounts between pages. */
async function allPages<T extends { id: string; organization_id: string; item_id?: string }>(resource: string, params: URLSearchParams, signal?: AbortSignal): Promise<T[]> {
  const version = getSession().version
  const records = new Map<string, T>()
  for (let offset = 0; ; offset += 500) {
    signal?.throwIfAborted()
    if (getSession().version !== version) throw new Error('Your session changed. Please reload inventory.')
    params.set('limit', '500')
    params.set('offset', String(offset))
    const page = await apiRequest<T[]>(`${base}/${resource}?${params}`, { signal })
    signal?.throwIfAborted()
    if (getSession().version !== version) throw new Error('Your session changed. Please reload inventory.')
    scopedRecords(page, params.get('organization_id')!)
    if (params.has('item_id') && page.some(record => record.item_id !== params.get('item_id'))) {
      throw new Error('The movement history did not match this equipment. Please reload inventory.')
    }
    page.forEach(record => records.set(record.id, record))
    if (page.length < 500) return [...records.values()]
  }
}

export function getInventoryItems(organizationId: string, signal?: AbortSignal, archived = false) {
  return allPages<InventoryItemRecord>('items', new URLSearchParams({ organization_id: organizationId, archived: String(archived) }), signal)
}

export function createInventoryItem(data: InventoryItemCreate) {
  return apiRequest<InventoryItemRecord>(`${base}/items`, { method: 'POST', body: data })
}

export function updateInventoryItem(itemId: string, organizationId: string, data: InventoryItemUpdate) {
  return apiRequest<InventoryItemRecord>(scopedPath('items', itemId, organizationId), { method: 'PATCH', body: data })
}

export function archiveInventoryItem(itemId: string, organizationId: string) {
  return apiRequest<null>(scopedPath('items', itemId, organizationId), { method: 'DELETE' })
}

export function restoreInventoryItem(itemId: string, organizationId: string) {
  return apiRequest<InventoryItemRecord>(`${base}/items/${encodeURIComponent(itemId)}/restore?${new URLSearchParams({ organization_id: organizationId })}`, { method: 'POST' })
}

export async function getInventoryCategories(organizationId: string, signal?: AbortSignal) {
  return scopedRecords(await apiRequest<InventoryCategoryRecord[]>(`${base}/categories?${new URLSearchParams({ organization_id: organizationId })}`, { signal }), organizationId)
}

export function createInventoryCategory(data: InventoryCategoryCreate) {
  return apiRequest<InventoryCategoryRecord>(`${base}/categories`, { method: 'POST', body: data })
}

export function updateInventoryCategory(id: string, organizationId: string, data: InventoryTaxonomyUpdate) {
  return apiRequest<InventoryCategoryRecord>(scopedPath('categories', id, organizationId), { method: 'PATCH', body: data })
}

export function deleteInventoryCategory(id: string, organizationId: string) {
  return apiRequest<null>(scopedPath('categories', id, organizationId), { method: 'DELETE' })
}

export async function getStorageLocations(organizationId: string, signal?: AbortSignal) {
  return scopedRecords(await apiRequest<StorageLocationRecord[]>(`${base}/locations?${new URLSearchParams({ organization_id: organizationId })}`, { signal }), organizationId)
}

export function createStorageLocation(data: StorageLocationCreate) {
  return apiRequest<StorageLocationRecord>(`${base}/locations`, { method: 'POST', body: data })
}

export function updateStorageLocation(id: string, organizationId: string, data: InventoryTaxonomyUpdate) {
  return apiRequest<StorageLocationRecord>(scopedPath('locations', id, organizationId), { method: 'PATCH', body: data })
}

export function deleteStorageLocation(id: string, organizationId: string) {
  return apiRequest<null>(scopedPath('locations', id, organizationId), { method: 'DELETE' })
}

export function getInventoryMovements(organizationId: string, itemId: string, signal?: AbortSignal) {
  return allPages<InventoryMovementRecord>('movements', new URLSearchParams({ organization_id: organizationId, item_id: itemId }), signal)
}

export function createInventoryMovement(data: InventoryMovementCreate) {
  return apiRequest<InventoryMovementRecord>(`${base}/movements`, { method: 'POST', body: data })
}

