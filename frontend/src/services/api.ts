import { getSession, setSessionToken } from './session'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/backend').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(message: string, status: number, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function responseMessage(payload: unknown, status: number): string {
  const detail = (payload as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') return detail.message
  if (Array.isArray(detail)) {
    return detail.map((issue: { loc?: Array<string | number>; msg?: string; row_number?: number }) => {
      if (issue.row_number) return `Row ${issue.row_number}: ${issue.msg || 'Invalid value'}`
      const field = issue.loc?.filter(part => part !== 'body' && part !== 'query').join(' · ')
      return `${field ? `${field}: ` : ''}${issue.msg || 'Invalid value'}`
    }).join('. ')
  }
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested item was not found or is no longer available.'
  if (status >= 500) return 'The server could not complete your request. Please try again.'
  return `Request failed (${status}). Please try again.`
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  auth?: boolean
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.auth === false ? null : getSession().token
  const formData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined && !formData) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : formData ? options.body as FormData : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'omit',
      redirect: 'error',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Unable to reach FieldOps Pro. Check your connection and make sure the API is running.', { cause: error })
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && token && getSession().token === token) {
      setSessionToken(null, 'Your session has expired. Please sign in again.')
    }
    throw new ApiError(responseMessage(payload, response.status), response.status, (payload as { detail?: unknown } | null)?.detail)
  }
  if (response.status !== 204 && payload === null) {
    throw new ApiError('The API returned an unexpected response. Check the API address and try again.', 502)
  }
  return payload as T
}
