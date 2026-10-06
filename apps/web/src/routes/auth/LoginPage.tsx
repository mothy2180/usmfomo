import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { errorKey } from '@usmfomo/shared/errors'
import { usernameSchema } from '@usmfomo/shared/schemas'
import { usernameToEmail } from '@usmfomo/shared/supabase'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { Button, Field, Input } from '../../components/ui.tsx'
import { studioDb } from '../../lib/db.ts'
import { currentLang } from '../../lib/i18n.ts'
import { saveLastActivity } from '../../lib/idle.ts'
import {
  clearIdleSignOut,
  needsSecondFactor,
  parsePostingStatus,
  signOutStudio,
  useIdleSignOutNotice,
  useStudioSession,
  type PostingStatus,
} from '../../lib/session.ts'
import { useTurnstile } from '../../lib/turnstile.ts'
import { ContactLink } from '../../features/studio/ContactLink.tsx'
import { useDocumentTitle } from '../../features/studio/useDocumentTitle.ts'

type FieldErrors = { username?: string; password?: string }

async function postingStatus(): Promise<PostingStatus | null> {
  const { data, error } = await studioDb.rpc('my_posting_status')
  if (error) return null
  try {
    return parsePostingStatus(data)
  } catch {
    return null // the studio checks again (and offers Retry)
  }
}

/** /login — club & school accounts (username + password + Turnstile). */
export function LoginPage() {
  const { t } = useTranslation('studio')
  useDocumentTitle(t('login.pageTitle'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ids = useId()
  const { ready, session } = useStudioSession()
  const idleSignedOut = useIdleSignOutNotice()
  const captcha = useTurnstile('login', currentLang())
  const { attach: attachCaptcha } = captcha
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // The "already signed in" redirect happens at most once, and never after a
  // sign-in attempt started (that flow decides where to go itself).
  const redirectCheckedRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)

  // Already signed in (this tab): straight to the studio, which re-checks.
  useEffect(() => {
    if (!ready || redirectCheckedRef.current) return
    redirectCheckedRef.current = true
    if (session) void navigate({ to: '/studio', replace: true })
  }, [ready, session, navigate])

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busyRef.current) return
    redirectCheckedRef.current = true
    const next: FieldErrors = {}
    const parsed = usernameSchema.safeParse(username)
    if (!username.trim()) next.username = t('login.usernameRequired')
    else if (!parsed.success) next.username = t('errors:username_format')
    if (!password) next.password = t('login.passwordRequired')
    // Commit the errors now, so the field is already marked invalid (and
    // described by its error) when it receives focus.
    flushSync(() => {
      setErrors(next)
      if (next.username || next.password) setFormError(null)
    })
    if (next.username || next.password || !parsed.success) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    if (!captcha.token) {
      setFormError(captcha.status === 'error' ? t('login.captchaError') : t('login.captchaNeeded'))
      return
    }

    busyRef.current = true
    setBusy(true)
    setFormError(null)
    clearIdleSignOut()
    let leaving = false
    try {
      // Start this tab's idle clock first: the SIGNED_IN event that follows
      // must not look like an idle session brought back (see session.ts).
      saveLastActivity()
      const { error } = await studioDb.auth.signInWithPassword({
        email: usernameToEmail(parsed.data),
        password,
        options: { captchaToken: captcha.token },
      })
      if (error) {
        setFormError(t(`errors:${errorKey(error)}`))
        return
      }
      setPassword('')

      // The owner account never uses the studio (it has its own console),
      // and a paused organisation can't post: say so and sign out here.
      const status = await postingStatus()
      if (status?.state === 'owner' || status?.state === 'inactive' || status?.state === 'no_account') {
        await signOutStudio(queryClient)
        setFormError(status.state === 'owner' ? t('login.ownerAccount') : t('errors:auth_paused'))
        return
      }

      const { data: aal } = await studioDb.auth.mfa.getAuthenticatorAssuranceLevel()
      leaving = true
      void navigate({ to: needsSecondFactor(aal, status) ? '/login/mfa' : '/studio' })
    } catch (err) {
      setFormError(t(`errors:${errorKey(err)}`))
    } finally {
      // Tokens are single-use: get a fresh one for the next attempt.
      if (!leaving) captcha.reset()
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <h1 className="m-0 text-2xl font-bold">{t('login.title')}</h1>
        {/* Always rendered (out of the layout while empty): the notice can
            also appear after this page loaded, when an idle session restored
            here is signed out. */}
        <div aria-live="polite" className={idleSignedOut ? undefined : 'sr-only'}>
          {idleSignedOut ? <p className="m-0 rounded-xl border border-sky/40 bg-sky/5 p-4 text-sm">{t('login.idleNotice')}</p> : null}
        </div>
        <p className="m-0 text-sm text-muted">
          <Trans t={t} i18nKey="login.note" components={{ contact: <ContactLink /> }} />
        </p>
        <p className="m-0 text-sm text-muted">{t('login.sharedComputer')}</p>

        <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <Field label={t('login.username')} error={errors.username}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={describedBy}
                aria-invalid={errors.username ? true : undefined}
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
            )}
          </Field>
          <Field label={t('login.password')} error={errors.password}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                aria-describedby={describedBy}
                aria-invalid={errors.password ? true : undefined}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            )}
          </Field>
          <div className="flex items-center gap-3">
            <input
              id={`${ids}-show`}
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.currentTarget.checked)}
              className="h-6 w-6 shrink-0 accent-accent"
            />
            <label htmlFor={`${ids}-show`} className="text-sm">
              {t('login.showPassword')}
            </label>
          </div>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">{t('login.captchaLabel')}</legend>
            <div ref={attachCaptcha} className="min-h-16 w-full" />
            <div aria-live="polite" className="mt-2 text-sm">
              {captcha.status === 'loading' ? <p className="m-0 text-xs text-muted">{t('login.captchaLoading')}</p> : null}
              {captcha.status === 'error' ? <p className="m-0 text-danger">{t('login.captchaError')}</p> : null}
            </div>
            {captcha.status === 'error' ? (
              <Button className="mt-2" onClick={captcha.retry}>
                {t('login.captchaRetry')}
              </Button>
            ) : null}
          </fieldset>

          {/* role=alert is announced when it appears; it is removed at the
              start of every attempt, so a repeated error is announced again. */}
          {formError ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {formError}
            </p>
          ) : null}

          <Button type="submit" variant="primary" busy={busy}>
            {t('login.submit')}
          </Button>
        </form>
      </div>
    </AppShell>
  )
}
