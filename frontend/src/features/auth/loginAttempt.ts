export interface LoginAttempt { id: number; sessionVersion: number }

/** A delayed sign-in must not replace a newer sign-in, sign-out, or session. */
export function isCurrentLoginAttempt(attempt: LoginAttempt, latestAttemptId: number, currentSessionVersion: number, aborted: boolean): boolean {
  return !aborted && attempt.id === latestAttemptId && attempt.sessionVersion === currentSessionVersion
}
