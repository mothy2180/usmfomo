import { useRef, useState, type FormEvent } from 'react'
import { Turnstile } from '../components/Turnstile.tsx'
import { Button, Callout, Checkbox, Field, FormError, Input } from '../components/ui.tsx'
import { PUBLIC_SITE_URL, TURNSTILE_SITE_KEY } from '../env.ts'
import { errorMessage } from '../lib/messages.ts'
import { useSession } from '../lib/sessionContext.ts'
import { publicLoginUrl } from '../lib/siteUrl.ts'
import { AuthLayout } from './AuthLayout.tsx'

export function SignInPage({ notice }: { notice: string | null }) {
  const session = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const errs: { username?: string; password?: string } = {}
    if (!username.trim()) errs.username = 'Enter your username.'
    if (!password) errs.password = 'Enter your password.'
    setFieldErrors(errs)
    if (errs.username) return usernameRef.current?.focus()
    if (errs.password) return passwordRef.current?.focus()
    if (!token) {
      setError('Complete the security check first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await session.signIn(username, password, token)
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
      // Turnstile tokens are single-use: get a new one for the next try.
      setResetKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Owner sign-in">
      {notice ? (
        <Callout tone="info">
          <p className="m-0">{notice}</p>
        </Callout>
      ) : null}
      <p className="m-0 text-sm text-muted">
        Club and school accounts sign in at{' '}
        <a href={publicLoginUrl(PUBLIC_SITE_URL)} className="text-sky underline">
          {publicLoginUrl(PUBLIC_SITE_URL).replace(/^https?:\/\//, '')}
        </a>
        . This console is for the usmfomo owner, with a password and an authenticator app.
      </p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Username" error={fieldErrors.username}>
          {({ id, describedBy, invalid }) => (
            <Input
              ref={usernameRef}
              id={id}
              name="username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field label="Password" error={fieldErrors.password}>
          {({ id, describedBy, invalid }) => (
            <Input
              ref={passwordRef}
              id={id}
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoComplete="current-password"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Checkbox label="Show password" checked={showPassword} onChange={setShowPassword} />
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm font-semibold">Security check</p>
          <Turnstile siteKey={TURNSTILE_SITE_KEY} onToken={setToken} resetKey={resetKey} />
        </div>
        <FormError message={error} />
        <Button type="submit" variant="primary" busy={busy}>
          Sign in
        </Button>
      </form>
      <p className="m-0 text-xs text-muted">
        You sign in again on every visit: the session is kept in this tab's memory only and ends after 30 minutes
        without activity.
      </p>
    </AuthLayout>
  )
}
