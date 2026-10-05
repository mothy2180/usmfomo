import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CopyButton } from '../components/CopyButton.tsx'
import { Button, Field, FormError, Input } from '../components/ui.tsx'
import { ownerDb } from '../lib/db.ts'
import { errorMessage } from '../lib/messages.ts'
import { removeUnverifiedTotp } from '../lib/mfa.ts'
import { groupSecret, isOtpauthUri, isSixDigitCode, isSvgDataUri, normaliseCode, validateDeviceName } from '../lib/totp.ts'

type Pending = { id: string; qr: string; secret: string; uri: string }

type Props = {
  defaultName: string
  /** Names already in use (Supabase rejects duplicates). */
  existingNames: readonly string[]
  /** The new device is verified; for a first device the session is now aal2. */
  onVerified: () => void | Promise<void>
}

/**
 * Two steps: name the device → scan the QR code (or type the setup key, or
 * open the otpauth:// link on the same phone) and enter its first code.
 */
export function EnrolFactor({ defaultName, existingNames, onVerified }: Props) {
  const [name, setName] = useState(defaultName)
  const [nameError, setNameError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingId = useRef<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // Leaving mid-way: drop the unverified factor so its name stays free.
  useEffect(
    () => () => {
      if (pendingId.current) void ownerDb.auth.mfa.unenroll({ factorId: pendingId.current })
    },
    [],
  )

  async function start(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const problem = validateDeviceName(name, existingNames)
    setNameError(problem)
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      await removeUnverifiedTotp()
      const { data, error: enrolError } = await ownerDb.auth.mfa.enroll({ factorType: 'totp', friendlyName: name.trim() })
      if (enrolError) throw enrolError
      pendingId.current = data.id
      setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri })
      setCode('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (busy || !pending) return
    const clean = normaliseCode(code)
    if (!isSixDigitCode(clean)) {
      setCodeError('Enter the 6-digit code shown in the app.')
      codeRef.current?.focus()
      return
    }
    setCodeError(null)
    setBusy(true)
    setError(null)
    try {
      const { error: verifyError } = await ownerDb.auth.mfa.challengeAndVerify({ factorId: pending.id, code: clean })
      if (verifyError) throw verifyError
      // Verified: the secret is no longer needed anywhere in this page.
      pendingId.current = null
      setPending(null)
      setCode('')
      await onVerified()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    const id = pendingId.current
    pendingId.current = null
    setPending(null)
    setError(null)
    if (id) await ownerDb.auth.mfa.unenroll({ factorId: id })
  }

  if (!pending) {
    return (
      <form onSubmit={start} noValidate className="flex flex-col gap-4">
        <Field label="Device name" hint="So you can tell your devices apart, e.g. “Phone” or “Backup phone”." error={nameError}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.currentTarget.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" busy={busy}>
          Show the QR code
        </Button>
      </form>
    )
  }

  const qrOk = isSvgDataUri(pending.qr)
  return (
    <form onSubmit={verify} noValidate className="flex flex-col gap-4">
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…).</li>
        <li>Scan this QR code, or enter the setup key by hand.</li>
        <li>Type the 6-digit code the app shows for usmfomo.</li>
      </ol>
      {qrOk ? (
        <div className="self-start rounded-lg bg-white p-3">
          <img src={pending.qr} alt="QR code for adding the usmfomo owner account to an authenticator app" width={192} height={192} className="block h-48 w-48" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <Field label="Setup key" hint="Time-based (TOTP), 6 digits, 30 seconds.">
          {({ id, describedBy }) => (
            <div className="flex flex-wrap items-start gap-2">
              <Input
                id={id}
                readOnly
                type={showKey ? 'text' : 'password'}
                value={showKey ? groupSecret(pending.secret) : pending.secret}
                aria-describedby={describedBy}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 basis-56 font-mono"
              />
              <Button onClick={() => setShowKey((s) => !s)} aria-pressed={showKey}>
                {showKey ? 'Hide key' : 'Show key'}
              </Button>
              <CopyButton text={pending.secret} label="Copy key" />
            </div>
          )}
        </Field>
      </div>
      {isOtpauthUri(pending.uri) ? (
        <p className="m-0 text-sm">
          On the phone itself? <a href={pending.uri} className="text-sky underline">Open in your authenticator app</a>.
        </p>
      ) : null}
      <Field label="6-digit code" error={codeError}>
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          Verify and add device
        </Button>
        <Button onClick={() => void cancel()} disabled={busy}>
          Start over
        </Button>
      </div>
    </form>
  )
}
