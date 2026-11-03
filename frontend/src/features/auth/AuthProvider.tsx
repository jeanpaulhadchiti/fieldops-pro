import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '../../services/api'
import { getSession, setSessionToken, subscribeSession, tokenExpiresAt } from '../../services/session'
import type { LoginCredentials, LoginResponse, User } from '../../types/api'
import { AuthContext } from './authContext'
import { isCurrentLoginAttempt } from './loginAttempt'

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  const loginAttempt = useRef(0)
  const profile = useQuery({
    queryKey: ['session', session.version, 'profile'],
    queryFn: ({ signal }) => apiRequest<User>('/auth/me', { signal }),
    enabled: Boolean(session.token),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!session.token) return
    const expiresAt = tokenExpiresAt(session.token)
    let timer: ReturnType<typeof setTimeout>
    const checkExpiry = () => {
      const remaining = (expiresAt ?? 0) - Date.now()
      if (remaining <= 0) {
        setSessionToken(null, 'Your session has expired. Please sign in again.')
      } else {
        timer = setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647))
      }
    }
    checkExpiry()
    const onFocus = () => { clearTimeout(timer); checkExpiry() }
    window.addEventListener('focus', onFocus)
    return () => { clearTimeout(timer); window.removeEventListener('focus', onFocus) }
  }, [session.token])

  async function login(values: LoginCredentials, signal?: AbortSignal) {
    const attempt = { id: ++loginAttempt.current, sessionVersion: getSession().version }
    const result = await apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: values, auth: false, signal })
    if (!isCurrentLoginAttempt(attempt, loginAttempt.current, getSession().version, Boolean(signal?.aborted))) {
      throw new Error('This sign-in was superseded by a newer account or session action. Continue with your current session.')
    }
    if (result.token_type?.toLowerCase() !== 'bearer' || !result.access_token || (tokenExpiresAt(result.access_token) ?? 0) <= Date.now()) {
      throw new Error('The API did not return a valid sign-in session. Please try again.')
    }
    setSessionToken(result.access_token)
  }

  return (
    <AuthContext.Provider value={{
      user: session.token ? profile.data ?? null : null,
      hasSession: Boolean(session.token),
      isLoading: Boolean(session.token) && profile.isPending,
      error: session.token ? profile.error : null,
      sessionMessage: session.message,
      login,
      logout: () => setSessionToken(null),
      retry: () => { void profile.refetch() },
    }}>
      {children}
    </AuthContext.Provider>
  )
}
