import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, CalendarDays, Compass, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Button, Field, LoadingState } from '../components/ui'
import { inputClassName } from '../components/ui/styles'
import { useAuth } from '../features/auth/useAuth'
import { getErrorMessage } from '../services/api'

const loginSchema = z.object({ email: z.string().trim().pipe(z.email('Enter a valid email address.')), password: z.string().min(1, 'Enter your password.') })
type LoginValues = z.infer<typeof loginSchema>

function safeReturnPath(state: unknown) {
  if (!state || typeof state !== 'object' || !('from' in state)) return '/dashboard'
  const from = state.from
  const path = typeof from === 'string' ? from : from && typeof from === 'object' && 'pathname' in from && typeof from.pathname === 'string' ? from.pathname : ''
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !path.startsWith('/login') ? path : '/dashboard'
}

export default function LoginPage() {
  const { user, login, isLoading, hasSession, error: sessionError, sessionMessage } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<unknown>(null)
  const [showPassword, setShowPassword] = useState(false)
  const loginController = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loginController.current?.abort() } }, [])
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const returnPath = safeReturnPath(location.state)

  async function onSubmit(values: LoginValues) {
    setError(null)
    const controller = new AbortController()
    loginController.current?.abort()
    loginController.current = controller
    try { await login(values, controller.signal); if (mounted.current) navigate(returnPath, { replace: true }) }
    catch (cause) { if (mounted.current && !controller.signal.aborted) setError(cause) }
  }

  if (isLoading) return <LoadingState label="Checking your session…" />
  if (user) return <Navigate to={returnPath} replace />
  if (hasSession && sessionError) return <Navigate to={returnPath} replace />

  return <main className="grid min-h-svh bg-white lg:grid-cols-[1.05fr_1fr]">
    <section className="relative hidden overflow-hidden bg-[#101f2c] p-12 text-white lg:flex lg:flex-col xl:p-16">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-400 p-2.5 text-slate-950"><Compass className="size-7" /></div><span className="text-2xl font-bold tracking-tight">FieldOps <span className="text-teal-300">Pro</span></span></div>
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-52 size-[600px] rounded-full border border-teal-300/10"><div className="absolute inset-20 rounded-full border border-teal-300/10" /><div className="absolute inset-40 rounded-full border border-teal-300/10" /></div>
      <div className="relative my-auto py-20"><p className="mb-5 text-xs font-bold tracking-[0.2em] text-teal-300 uppercase">Ready for the field</p><h1 className="max-w-lg text-5xl leading-[1.12] font-bold tracking-tight xl:text-6xl">Good operations<br />start together.</h1><p className="mt-6 max-w-sm text-base leading-7 text-slate-400">Bring your people and events into one organized workspace. Spend less time coordinating and more time making things happen.</p><div className="mt-10 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/4 p-5"><div className="rounded-xl bg-teal-400/10 p-3 text-teal-300"><CalendarDays className="size-6" /></div><div><p className="text-sm font-semibold">Plan. Coordinate. Deliver.</p><p className="mt-1 text-xs leading-5 text-slate-400">A clear view of every event, for every team.</p></div></div></div>
      <p className="text-xs text-slate-500">FieldOps Pro · Operations, organized.</p>
    </section>
    <section className="flex flex-col justify-center px-6 py-12 sm:px-14 lg:px-12 xl:px-20"><div className="mx-auto w-full max-w-sm">
      <div className="mb-12 flex items-center gap-2 text-xl font-bold text-slate-900 lg:hidden"><Compass className="size-7 text-teal-700" />FieldOps Pro</div>
      <p className="mb-3 text-xs font-bold tracking-[0.15em] text-teal-700 uppercase">Your workspace awaits</p><h2 className="text-3xl font-bold tracking-tight text-slate-900">Welcome back</h2><p className="mt-3 text-sm leading-6 text-slate-500">Sign in to manage your organization’s operations.</p>
      <form className="mt-8 space-y-5" noValidate onSubmit={event => void handleSubmit(onSubmit)(event)}>
        {sessionMessage && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{sessionMessage}</p>}
        {error != null && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{getErrorMessage(error)}</p>}
        <Field label="Email address" htmlFor="email" error={errors.email?.message}><input {...register('email')} id="email" type="email" autoComplete="username" autoFocus placeholder="you@organization.com" className={inputClassName} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} disabled={isSubmitting} /></Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}><div className="relative"><input {...register('password')} id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className={`${inputClassName} pr-12`} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} disabled={isSubmitting} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)} className="absolute top-1.5 right-1.5 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></Field>
        <Button type="submit" busy={isSubmitting} className="w-full">{isSubmitting ? 'Signing in…' : 'Sign in'}{!isSubmitting && <ArrowRight className="size-4" />}</Button>
      </form>
      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400"><ShieldCheck className="size-4" aria-hidden="true" />Access is managed by your organization.</p>
      <div className="mt-12 border-t border-slate-100 pt-5"><p className="text-sm leading-6 text-slate-500">New to FieldOps Pro? <Link to="/signup" className="font-semibold text-teal-700 underline underline-offset-4">Create an account</Link></p><p className="mt-2 text-xs leading-6 text-slate-500">After signing in, you can create an organization or request to join a discoverable team.</p></div>
    </div></section>
  </main>
}
