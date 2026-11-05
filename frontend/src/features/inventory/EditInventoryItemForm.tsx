import type { InventoryItemRecord } from '../../types/api'
import InventoryItemForm from './InventoryItemForm'

export default function EditInventoryItemForm({ item, onClose }: { item: InventoryItemRecord; onClose: () => void }) {
  return <InventoryItemForm organizationId={item.organization_id} item={item} onClose={onClose} />
}
