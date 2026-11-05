import InventoryTaxonomyForm from './InventoryTaxonomyForm'

export default function CreateInventoryCategoryForm({ organizationId }: { organizationId: string }) {
  return <InventoryTaxonomyForm organizationId={organizationId} kind="categories" />
}
