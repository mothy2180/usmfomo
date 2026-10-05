import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { Button } from '../../components/ui.tsx'
import { signOutStudio } from '../../lib/session.ts'
import { useDocumentTitle } from './useDocumentTitle.ts'

/** Signs out this browser only (scope 'local'), then goes to /login. */
export function SignOutButton() {
  const { t } = useTranslation('studio')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const signOut = async () => {
    setBusy(true)
    setFailed(false)
    const { error } = await signOutStudio(queryClient)
    setBusy(false)
    if (error) setFailed(true)
    else void navigate({ to: '/login', replace: true })
  }

  return (
    <>
      <Button onClick={() => void signOut()} busy={busy}>
        {t('nav.signOut')}
      </Button>
      {failed ? (
        <p role="alert" className="m-0 basis-full text-sm text-danger">
          {t('nav.signOutFailed')}
        </p>
      ) : null}
    </>
  )
}

function StudioNav() {
  const { t } = useTranslation('studio')
  const link = 'inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:bg-surface-2 hover:text-text [&.active]:text-text [&.active]:font-semibold'
  return (
    <nav aria-label={t('nav.label')} className="flex flex-wrap items-center gap-2">
      <Link to="/studio" activeOptions={{ exact: true }} className={link}>
        {t('nav.home')}
      </Link>
      <Link to="/studio/settings" className={link}>
        {t('nav.settings')}
      </Link>
      <SignOutButton />
    </nav>
  )
}

/** Page frame for every studio page: title, organisation, studio navigation. */
export function StudioFrame({ title, orgName, children }: { title: string; orgName?: string; children: ReactNode }) {
  useDocumentTitle(title)
  return (
    <AppShell wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {orgName ? <p className="m-0 text-sm break-words text-muted">{orgName}</p> : null}
          <h1 className="m-0 text-2xl font-bold break-words">{title}</h1>
        </div>
        {orgName ? <StudioNav /> : null}
      </div>
      {children}
    </AppShell>
  )
}
