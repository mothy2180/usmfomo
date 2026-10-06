import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Button, Field, FormError, Input } from '../components/ui.tsx'
import { ownerDb } from '../lib/db.ts'
import { errorMessage } from '../lib/messages.ts'
import type { OwnerFactor } from '../lib/mfa.ts'
import { useSession } from '../lib/sessionContext.ts'
import { isSixDigitCode, normaliseCode } from '../lib/totp.ts'
import { AuthLayout } from './AuthLayout.tsx'

/** Password accepted (aal1) and a device is enrolled: ask for its code. */
export function ChallengePage({ factors }: { factors: OwnerFactor[] }) {
  const session = useSession()
  const [factorId, setFactorId] = useState(factors[0]?.id ?? '')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const clean = normaliseCode(code)
    if (!isSixDigitCode(clean)) {
      // Commit the error first, so the field is already invalid (and described
      // by it) when it receives focus.
      flushSync(() => setCodeError('Enter the 6-digit code shown in your authenticator app.'))
      codeRef.current?.focus()
      return
    }
    setCodeError(null)
    setBusy(true)
    setError(null)
    try {
      const { error: verifyError } = await ownerDb.auth.mfa.challengeAndVerify({ factorId, code: clean })
      if (verifyError) throw verifyError
      setCode('')
      await session.mfaVerified()
    } catch (err) {
      flushSync(() => {
        setError(errorMessage(err))
        setCode('')
      })
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Enter your authenticator code">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {factors.length > 1 ? (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-semibold">
              Device
            </legend>
            {factors.map((f) => (
              <label key={f.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3">
                <input
                  type="radio"
                  name="factor"
                  value={f.id}
                  checked={factorId === f.id}
                  onChange={() => setFactorId(f.id)}
                  className="h-5 w-5 accent-accent"
                />
                <span className="text-sm">{f.name}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="m-0 text-sm text-muted">Device: {factors[0]?.name}</p>
        )}
        <Field label="6-digit code" error={codeError} hint="Codes change every 30 seconds.">
          {({ id, describedBy, invalid }) => (
            <Input
              ref={codeRef}
              id={id}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="max-w-48 font-mono text-lg tracking-widest"
            />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" busy={busy}>
          Verify
        </Button>
      </form>
      <p className="m-0 text-xs text-muted">
        Lost every device? Use the break-glass command <code className="font-mono">pnpm account owner-reset-mfa</code>{' '}
        on your laptop, then enrol new devices here.
      </p>
      <Button variant="ghost" onClick={() => void session.signOut()} className="self-start">
        Sign out
      </Button>
    </AuthLayout>
  )
}
