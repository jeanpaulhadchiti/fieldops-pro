import { createContext } from 'react'
import type { LoginCredentials, User } from '../../types/api'

export interface AuthContextValue {
  user: User | null
  hasSession: boolean
  isLoading: boolean
  error: unknown
  sessionMessage: string | null
  login: (values: LoginCredentials, signal?: AbortSignal) => Promise<void>
  logout: () => void
  retry: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
