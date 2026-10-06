import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { Button, ButtonLink, ErrorState, Spinner } from '../../components/ui.tsx'
import { STUDIO_QUERY_KEY, signOutStudio, useStudioSession } from '../../lib/session.ts'
import { CODE_INPUT_SELECTOR, CodeField } from '../../features/studio/CodeField.tsx'
import { ContactLink } from '../../features/studio/ContactLink.tsx'
import { studioErrorKey } from '../../features/studio/errorMessage.ts'
import { initialFactorId, isCompleteCode, type TotpFactor } from '../../features/studio/factors.ts'
import { IdleSignOut } from '../../features/studio/IdleSignOut.tsx'
import { loadMfaLogin, verifyCode } from '../../features/studio/mfa.ts'
import { mfaStep, readLastFactor, saveLastFactor } from '../../features/studio/mfaLogin.ts'
import { useDocumentTitle } from '../../features/studio/useDocumentTitle.ts'

/** /login/mfa — the second sign-in step for accounts with 2FA devices. */
export function MfaPage() {
  const { t } = useTranslation('studio')
  useDocumentTitle(t('mfa.pageTitle'))
  const navigate = useNavigate()
  const { ready, session } = useStudioSession()
  const userId = session?.user.id ?? ''
  const state = useQuery({
    queryKey: [...STUDIO_QUERY_KEY, 'mfa-login', userId],
    queryFn: loadMfaLogin,
    enabled: userId !== '',
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const step = mfaStep(ready, Boolean(session), state.data)

  useEffect(() => {
    if (step === 'login') void navigate({ to: '/login', replace: true })
    else if (step === 'studio') void navigate({ to: '/studio', replace: true })
  }, [step, navigate])

  let body
  if (step === 'code' && state.data) body = <MfaForm factors={state.data.factors} />
  else if (state.isError && !state.data) body = <ErrorState error={state.error} onRetry={() => void state.refetch()} />
  else body = <Spinner />

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <h1 className="m-0 text-2xl font-bold">{t('mfa.title')}</h1>
        {body}
      </div>
      {/* A password-only session waiting here times out like the studio. */}
      <IdleSignOut enabled={Boolean(session)} />
    </AppShell>
  )
}

function MfaForm({ factors }: { factors: TotpFactor[] }) {
  const { t } = useTranslation('studio')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ids = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [factorId, setFactorId] = useState<string | null>(() => initialFactorId(factors, readLastFactor()))
  const [code, setCode] = useState('')
  const [chooseError, setChooseError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const focus = (selector: string) => formRef.current?.querySelector<HTMLElement>(selector)?.focus()

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busyRef.current) return
    const chosen = factors.find((f) => f.id === factorId)
    // Commit the errors first, so focus lands on a field that already
    // carries (and is described by) its error.
    flushSync(() => {
      setFormError(null)
      setChooseError(chosen ? null : 'mfa.chooseFactor')
      setCodeError(isCompleteCode(code) ? null : 'mfa.codeInvalid')
    })
    if (!chosen) return focus('input[type="radio"]')
    if (!isCompleteCode(code)) return focus(CODE_INPUT_SELECTOR)

    busyRef.current = true
    setBusy(true)
    try {
      await verifyCode(chosen.id, code)
      saveLastFactor(chosen.id)
      void navigate({ to: '/studio', replace: true })
    } catch (err) {
      const key = studioErrorKey(err)
      setCode('')
      setFormError(key)
      // Another member's sign-in (or a password reset) ended this session.
      if (key === 'errors:session_ended') setEnded(true)
      else focus(CODE_INPUT_SELECTOR)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const switchAccount = async () => {
    await signOutStudio(queryClient)
    void navigate({ to: '/login', replace: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 text-sm text-muted">{t('mfa.intro')}</p>
      <form ref={formRef} noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        {factors.length > 1 ? (
          <fieldset aria-describedby={chooseError ? `${ids}-choose-err` : undefined} className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">{t('mfa.whose')}</legend>
            <div className="flex flex-col gap-2">
              {factors.map((f) => (
                <label
                  key={f.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 has-[:checked]:border-sky"
                >
                  <input
                    type="radio"
                    name={`${ids}-factor`}
                    value={f.id}
                    checked={factorId === f.id}
                    onChange={() => {
                      setFactorId(f.id)
                      setChooseError(null)
                    }}
                    className="h-5 w-5 shrink-0 accent-accent"
                  />
                  <span className="break-words">{f.friendly_name || t('settings.unnamed')}</span>
                </label>
              ))}
            </div>
            {chooseError ? (
              <p id={`${ids}-choose-err`} className="mt-1 mb-0 text-xs text-danger">
                {t(chooseError)}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <CodeField
          value={code}
          error={codeError}
          disabled={ended}
          onChange={(next) => {
            setCode(next)
            setCodeError(null)
          }}
        />

        {formError ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {t(formError)}
          </p>
        ) : null}

        {ended ? (
          <ButtonLink to="/login" variant="primary" replace>
            {t('guard.signInAgain')}
          </ButtonLink>
        ) : (
          <Button type="submit" variant="primary" busy={busy}>
            {t('mfa.submit')}
          </Button>
        )}
      </form>

      <Button variant="ghost" className="self-start" onClick={() => void switchAccount()} disabled={busy}>
        {t('mfa.otherAccount')}
      </Button>

      <section aria-labelledby={`${ids}-lost`} className="rounded-xl border border-line bg-surface p-4">
        <h2 id={`${ids}-lost`} className="m-0 text-base font-bold">
          {t('mfa.lostTitle')}
        </h2>
        <p className="mt-2 mb-0 text-sm text-muted">
          <Trans t={t} i18nKey="mfa.lostBody" components={{ contact: <ContactLink /> }} />
        </p>
      </section>
    </div>
  )
}
