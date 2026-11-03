import { z } from 'zod'
import { apiRequest } from '../../services/api'

const notificationSchema = z.object({
  id: z.uuid(), organization_id: z.uuid(), organization_name: z.string(),
  join_request_id: z.uuid(), applicant_name: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  created_at: z.string(), updated_at: z.string(), read_at: z.string().nullable(),
})
const pageSchema = z.object({
  items: z.array(notificationSchema), unread_count: z.number().int().nonnegative(), has_more: z.boolean(),
})
export type JoinNotification = z.infer<typeof notificationSchema>

export const notificationKeys = {
  recipient: (userId: string, sessionVersion: number) => ['notifications', userId, sessionVersion] as const,
  page: (userId: string, sessionVersion: number, page: number) => ['notifications', userId, sessionVersion, page] as const,
}

export async function getNotifications(page: number, signal?: AbortSignal) {
  const parsed = pageSchema.safeParse(await apiRequest<unknown>(`/notifications?page=${page}&page_size=20`, { signal }))
  if (!parsed.success) throw new Error('The API returned inconsistent notification data. Refresh your notifications.')
  return parsed.data
}

export async function setNotificationRead(item: JoinNotification, isRead: boolean) {
  const parsed = notificationSchema.safeParse(await apiRequest<unknown>(`/notifications/${item.id}`, { method: 'PATCH', body: { is_read: isRead } }))
  if (!parsed.success || parsed.data.id !== item.id || parsed.data.organization_id !== item.organization_id || parsed.data.join_request_id !== item.join_request_id || Boolean(parsed.data.read_at) !== isRead) {
    throw new Error('The API returned an inconsistent notification update. Refresh before trying again.')
  }
  return parsed.data
}

export function notificationTarget(item: JoinNotification) {
  return `/settings/members?organization=${encodeURIComponent(item.organization_id)}&section=requests&request=${encodeURIComponent(item.join_request_id)}&status=${item.status}`
}
