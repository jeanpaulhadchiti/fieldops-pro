import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, CheckCircle2, Compass, Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button, Field, LoadingState } from '../components/ui'
import { inputClassName } from '../components/ui/styles'
import { useAuth } from '../features/auth/useAuth'
import { isUncertainWrite, signup } from '../features/onboarding/api'
import { signupSchema } from '../features/onboarding/schemas'
import type { SignupValues } from '../features/onboarding/types'
import { getErrorMessage } from '../services/api'
import { getSession } from '../services/session'

export default function SignupPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const mounted = useRef(false)
  const sending = useRef(false)
  const loginController = useRef<AbortController | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [accountCreated, setAccountCreated] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema), defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loginController.current?.abort() } }, [])

  async function onSubmit(values: SignupValues) {
    if (sending.current || accountCreated || uncertain) return
    sending.current = true
    setError(null)
    const version = getSession().version
    let saved = false
    try {
      await signup(values)
      saved = true
      if (!mounted.current || getSession().version !== version) return
      setAccountCreated(true)
      const controller = new AbortController()
      loginController.current = controller
      await auth.login({ email: values.email, password: values.password }, controller.signal)
      if (mounted.current) navigate('/onboarding', { replace: true })
    } catch (cause) {
      if (mounted.current && (getSession().version === version || saved)) {
        setError(cause)
        if (!saved && isUncertainWrite(cause)) setUncertain(true)
      }
    } finally { sending.current = false }
  }

  if (auth.isLoading) return <LoadingState label="Checking your session…" />
  if (auth.user || auth.hasSession) return <Navigate to="/onboarding" replace />

  const blocked = isSubmitting || accountCreated || uncertain
  return <main className="grid min-h-svh bg-white lg:grid-cols-[0.9fr_1.1fr]">
    <section className="relative hidden flex-col overflow-hidden bg-[#101f2c] p-12 text-white lg:flex xl:p-16">
      <Link to="/login" className="flex items-center gap-3"><div className="rounded-xl bg-teal-400 p-2.5 text-slate-950"><Compass className="size-7" aria-hidden="true" /></div><span className="text-2xl font-bold tracking-tight">FieldOps <span className="text-teal-300">Pro</span></span></Link>
      <div aria-hidden="true" className="pointer-events-none absolute top-20 -right-48 size-[550px] rounded-full border border-teal-300/10"><div className="absolute inset-20 rounded-full border border-teal-300/10" /><div className="absolute inset-40 rounded-full border border-teal-300/10" /></div>
      <div className="relative my-auto py-20"><p className="mb-5 text-xs font-bold tracking-[0.2em] text-teal-300 uppercase">Make room for your team</p><h1 className="max-w-lg text-5xl leading-[1.12] font-bold tracking-tight">Your next operation<br />starts here.</h1><p className="mt-6 max-w-sm text-base leading-7 text-slate-400">Create a workspace for your organization, or request access to a team you already know.</p><p className="mt-9 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/4 p-5 text-sm leading-6 text-slate-300"><LockKeyhole className="mt-1 size-5 shrink-0 text-teal-300" aria-hidden="true" />Every workspace has its own members and permissions. Joining an existing team requires approval.</p></div>
      <p className="text-xs text-slate-500">FieldOps Pro · Operations, organized.</p>
    </section>
    <section className="flex flex-col justify-center px-6 py-10 sm:px-14 lg:px-12 xl:px-20"><div className="mx-auto w-full max-w-md">
      <Link to="/login" className="mb-10 flex items-center gap-2 text-xl font-bold text-slate-900 lg:hidden"><Compass className="size-7 text-teal-700" aria-hidden="true" />FieldOps Pro</Link>
      <p className="mb-3 text-xs font-bold tracking-[0.15em] text-teal-700 uppercase">Get started</p><h2 className="text-3xl font-bold tracking-tight text-slate-900">Create your account</h2><p className="mt-3 text-sm leading-6 text-slate-500">Start with your personal account. You’ll choose an organization next.</p>
      {accountCreated ? <div className="mt-7 space-y-4"><p role="status" className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900"><CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />Your account has been created. Sign in to continue to organization onboarding.</p>{error != null && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{getErrorMessage(error)}</p>}<Link to="/login" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">Continue to sign in<ArrowRight className="size-4" aria-hidden="true" /></Link></div> : <form noValidate onSubmit={event => void handleSubmit(onSubmit)(event)} className="mt-7 space-y-5">
        {error != null && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">{getErrorMessage(error)}</p>}
        {uncertain && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">The account may have been created, but its outcome could not be confirmed. Try signing in before submitting another registration. <Link to="/login" className="font-semibold underline">Go to sign in</Link>.</p>}
        <Field label="Full name" htmlFor="signup-name" error={errors.name?.message}><input {...register('name')} id="signup-name" autoComplete="name" maxLength={120} autoFocus className={inputClassName} disabled={blocked} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'signup-name-error' : undefined} /></Field>
        <Field label="Email address" htmlFor="signup-email" error={errors.email?.message}><input {...register('email')} id="signup-email" type="email" autoComplete="username" maxLength={255} className={inputClassName} disabled={blocked} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'signup-email-error' : undefined} /></Field>
        <Field label="Password" htmlFor="signup-password" error={errors.password?.message} hint="Use 10–128 characters, including at least one uppercase letter (A–Z) and one special character, such as !, @, or #."><div className="relative"><input {...register('password')} id="signup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={256} className={`${inputClassName} pr-12`} disabled={blocked} aria-invalid={!!errors.password} aria-describedby={`signup-password-hint${errors.password ? ' signup-password-error' : ''}`} /><button type="button" disabled={blocked} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} className="absolute top-1.5 right-1.5 rounded-lg p-2 text-slate-500 hover:bg-slate-50">{showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button></div></Field>
        <Field label="Confirm password" htmlFor="signup-confirm" error={errors.confirmPassword?.message}><input {...register('confirmPassword')} id="signup-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={256} className={inputClassName} disabled={blocked} aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? 'signup-confirm-error' : undefined} /></Field>
        <Button type="submit" busy={isSubmitting} disabled={blocked} className="w-full">{isSubmitting ? 'Creating your account…' : 'Create account'}{!isSubmitting && <ArrowRight className="size-4" aria-hidden="true" />}</Button>
      </form>}
      <p className="mt-7 text-center text-sm text-slate-500">Already have an account? <Link to="/login" className="font-semibold text-teal-700 underline underline-offset-4">Sign in</Link></p>
    </div></section>
  </main>
}
