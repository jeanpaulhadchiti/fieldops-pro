/** Contracts from backend/app/schemas and the existing FastAPI routers. */
export interface User {
  id: string
  name: string
  email: string
  created_at: string
}

export interface Organization {
  id: string
  name: string
  created_at: string
  organization_type?: 'Scout Group' | 'Sports Club' | 'NGO' | 'Other'
  organization_type_other?: string | null
  country?: string | null
  city?: string | null
  description?: string | null
  is_discoverable?: boolean
  archived_at?: string | null
  archived_by?: string | null
}

export interface Membership {
  id: string
  user_id: string
  name: string
  email: string
  role: string
  status: string
  created_at: string
}

export interface LoginCredentials { email: string; password: string }
export interface LoginResponse { access_token: string; token_type: string }

export interface EventRecord {
  id: string
  organization_id: string
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string
  status: string
  archived_at: string | null
  created_at: string
  capacity: number | null
}

export interface EventCreate {
  organization_id: string
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string
  capacity: number | null
}


export type InventoryItemType = 'consumable' | 'reusable'

export interface InventoryItemRecord {
  id: string
  organization_id: string
  category_id: string | null
  location_id: string | null
  name: string
  sku: string | null
  unit: string
  item_type: InventoryItemType
  current_quantity: string
  minimum_quantity: string
  archived: boolean
  created_at: string
}

export interface InventoryCategoryRecord {
  id: string
  organization_id: string
  name: string
  description: string | null
  created_at: string
}

export interface StorageLocationRecord {
  id: string
  organization_id: string
  name: string
  description: string | null
  created_at: string
}

export type InventoryMovementType =
  | 'opening'
  | 'receive'
  | 'issue'
  | 'return'
  | 'adjustment'

export interface InventoryMovementRecord {
  id: string
  organization_id: string
  item_id: string
  sequence_number: number
  movement_type: InventoryMovementType
  quantity_delta: string
  quantity_before: string
  quantity_after: string
  actor_id: string | null
  notes: string | null
  created_at: string
}


export interface InventoryItemCreate {
  organization_id: string
  category_id?: string | null
  location_id?: string | null
  name: string
  sku?: string | null
  unit: string
  item_type: InventoryItemType
  minimum_quantity: string
}


export interface InventoryItemUpdate {
  name?: string
  sku?: string | null
  category_id?: string | null
  location_id?: string | null
  unit?: string
  item_type?: InventoryItemType
  minimum_quantity?: string
}


export interface InventoryCategoryCreate {
  organization_id: string
  name: string
  description?: string | null
}


export interface StorageLocationCreate {
  organization_id: string
  name: string
  description?: string | null
}

export interface InventoryTaxonomyUpdate {
  name: string
  description: string | null
}

export interface InventoryMovementCreate {
  organization_id: string
  item_id: string
  movement_type: InventoryMovementType
  quantity_delta: string
  notes: string | null
}
