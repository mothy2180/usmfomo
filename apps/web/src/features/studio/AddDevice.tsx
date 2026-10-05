import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Input } from '../../components/ui.tsx'
import { STUDIO_QUERY_KEY } from '../../lib/session.ts'
import { CODE_INPUT_SELECTOR, CodeField } from './CodeField.tsx'
import { studioErrorKey } from './errorMessage.ts'
import { cleanDeviceName, DEVICE_NAME_MAX, groupSecret, isCompleteCode, isNameTaken, type TotpFactor } from './factors.ts'
import { cancelEnrollment, startEnrollment, verifyCode, type Enrollment } from './mfa.ts'

type Props = {
  /** Verified devices, for the duplicate-name check. */
  existing: TotpFactor[]
  /** Called with the new device's name once its first code was accepted. */
  onAdded: (name: string) => void
}

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Add a 2FA device: the person's name -> QR code, setup key and otpauth link
 * -> the first 6-digit code. Each committee member adds their own phone; the
 * form resets afterwards so the next member can go straight on.
 */
export function AddDevice({ existing, onAdded }: Props) {
  const { t } = useTranslation('studio')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const rootRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [copy, setCopy] = useState<CopyState>('idle')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // An unconfirmed setup to abandon if the page is left half-way.
  const pendingRef = useRef<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<{ selector: string; n: number } | null>(null)

  useEffect(() => {
    if (focusTarget) rootRef.current?.querySelector<HTMLElement>(focusTarget.selector)?.focus()
  }, [focusTarget])
  const focusSoon = (selector: string) => setFocusTarget((f) => ({ selector, n: (f?.n ?? 0) + 1 }))

  useEffect(
    () => () => {
      const id = pendingRef.current
      pendingRef.current = null
      if (id) void cancelEnrollment(id)
    },
    [],
  )

  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const start = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setFormError(null)
    const cleaned = cleanDeviceName(name)
    const problem = !cleaned.ok ? cleaned.key : isNameTaken(cleaned.name, existing) ? 'settings.nameTaken' : null
    setNameError(problem)
    if (problem || !cleaned.ok) return focusSoon('input[name="device-name"]')
    void run(async () => {
      try {
        const next = await startEnrollment(cleaned.name)
        pendingRef.current = next.factorId
        setEnrollment(next)
        setCode('')
        setCodeError(null)
        setCopy('idle')
        focusSoon('[data-setup-heading]')
      } catch (err) {
        const key = studioErrorKey(err)
        if (key === 'errors:mfa_required') {
          // A device exists, so adding another needs a session that passed 2FA.
          void navigate({ to: '/login/mfa' })
          return
        }
        if (key === 'studio:settings.nameTaken') {
          setNameError(key)
          focusSoon('input[name="device-name"]')
        } else setFormError(key)
      }
    })
  }

  const verify = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!enrollment) return
    setFormError(null)
    if (!isCompleteCode(code)) {
      setCodeError('mfa.codeInvalid')
      return focusSoon(CODE_INPUT_SELECTOR)
    }
    void run(async () => {
      try {
        await verifyCode(enrollment.factorId, code)
        pendingRef.current = null
        setEnrollment(null)
        setName('')
        setCode('')
        onAdded(enrollment.name)
        focusSoon('input[name="device-name"]')
      } catch (err) {
        const key = studioErrorKey(err)
        setCode('')
        if (key === 'errors:auth_bad_code') setCodeError(key)
        else setFormError(key)
        focusSoon(CODE_INPUT_SELECTOR)
      } finally {
        // The device list, the factor count and this session's level changed.
        void queryClient.invalidateQueries({ queryKey: STUDIO_QUERY_KEY })
      }
    })
  }

  const cancel = () => {
    const id = enrollment?.factorId
    pendingRef.current = null
    setEnrollment(null)
    setCode('')
    setCodeError(null)
    setFormError(null)
    focusSoon('input[name="device-name"]')
    if (id) void cancelEnrollment(id)
  }

  const copyKey = async () => {
    if (!enrollment) return
    try {
      await navigator.clipboard.writeText(enrollment.secret)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  const errorBox = formError ? (
    <p role="alert" className="m-0 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
      {t(formError)}
    </p>
  ) : null

  if (!enrollment) {
    return (
      <div ref={rootRef}>
        <form noValidate onSubmit={start} className="flex flex-col gap-4">
          <Field label={t('settings.personName')} hint={t('settings.personHint')} error={nameError ? t(nameError) : null}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="device-name"
                autoComplete="off"
                maxLength={DEVICE_NAME_MAX}
                aria-describedby={describedBy}
                aria-invalid={nameError ? true : undefined}
                value={name}
                onChange={(e) => {
                  setName(e.currentTarget.value)
                  setNameError(null)
                }}
              />
            )}
          </Field>
          {errorBox}
          <Button type="submit" variant="primary" busy={busy} className="self-start">
            {t('settings.start')}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4 rounded-xl border border-sky/40 bg-sky/5 p-4">
      <h3 data-setup-heading tabIndex={-1} className="m-0 text-base font-bold break-words">
        {t('settings.scanTitle', { name: enrollment.name })}
      </h3>
      <ol className="m-0 flex flex-col gap-4 pl-5">
        <li className="flex flex-col gap-3">
          <p className="m-0 text-sm">{t('settings.scanStep')}</p>
          {enrollment.qrSrc ? (
            // The SVG only draws the dark modules: the white backing is required.
            <img src={enrollment.qrSrc} alt={t('settings.qrAlt')} width={224} height={224} className="h-auto w-56 max-w-full rounded-lg bg-white p-3" />
          ) : null}
          <p className="m-0 text-sm">{t('settings.phoneStep')}</p>
          {enrollment.uri ? (
            <a
              href={enrollment.uri}
              className="inline-flex min-h-11 items-center justify-center self-start rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-text no-underline hover:border-sky"
            >
              {t('settings.openApp')}
            </a>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm font-semibold">{t('settings.setupKey')}</p>
            <code className="block rounded-lg border border-line bg-ink p-3 font-mono text-base break-all select-all">
              {groupSecret(enrollment.secret)}
            </code>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void copyKey()}>{t('settings.copy')}</Button>
              <span aria-live="polite" className="text-sm text-muted">
                {copy === 'copied' ? t('settings.copied') : copy === 'failed' ? t('settings.copyFailed') : ''}
              </span>
            </div>
          </div>
        </li>
        <li>
          <form noValidate onSubmit={verify} className="flex flex-col gap-4">
            <p className="m-0 text-sm">{t('settings.codeStep')}</p>
            <CodeField
              value={code}
              error={codeError}
              onChange={(next) => {
                setCode(next)
                setCodeError(null)
              }}
            />
            {errorBox}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" busy={busy}>
                {t('settings.verify')}
              </Button>
              <Button onClick={cancel} disabled={busy}>
                {t('settings.cancelSetup')}
              </Button>
            </div>
          </form>
        </li>
      </ol>
    </div>
  )
}
