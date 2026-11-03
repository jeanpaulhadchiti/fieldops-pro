import type { DiscoverySearch } from './types'

export const onboardingKeys = {
  ownRequests: (userId: string, page: number) => ['my-join-requests', userId, page] as const,
  discovery: (userId: string, search: DiscoverySearch | null) => ['organization-discovery', userId, search?.q ?? '', search?.organization_type ?? '', search?.country ?? '', search?.city ?? ''] as const,
}
