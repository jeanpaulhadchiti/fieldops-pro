import InventoryItemForm from './InventoryItemForm'

export default function CreateInventoryItemForm({ organizationId }: { organizationId: string }) {
  return <InventoryItemForm organizationId={organizationId} />
}
