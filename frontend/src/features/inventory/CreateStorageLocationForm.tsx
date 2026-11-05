import InventoryTaxonomyForm from './InventoryTaxonomyForm'

export default function CreateStorageLocationForm({ organizationId }: { organizationId: string }) {
  return <InventoryTaxonomyForm organizationId={organizationId} kind="locations" />
}
