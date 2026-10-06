import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ButtonLink, ErrorState, Spinner } from '../../components/ui.tsx'
import { signOutStudio, useStudioAccess, type OkStatus } from '../../lib/session.ts'
import { IdleSignOut } from './IdleSignOut.tsx'
import { StudioFrame } from './StudioFrame.tsx'

type Terminal = 'owner' | 'inactive' | 'ended'

/**
 * Renders a studio page only for a session the database accepts
 * (my_posting_status = ok). Otherwise: /login, /login/mfa, or a message for
 * the owner account, a paused account or a revoked session — and those three
 * are signed out of this browser straight away. While the page is shown, 30
 * minutes without input sign this browser out (IdleSignOut).
 */
export function StudioGuard({
  title,
  children,
}: {
  title: string
  children: (ctx: { status: OkStatus; session: Session }) => ReactNode
}) {
  const { t } = useTranslation('studio')
  const access = useStudioAccess()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const decision = access.phase === 'ready' ? access.decision : null
  // Sticky: signing out turns the decision into 'login', but the message
  // must stay on screen. Set while rendering (no effect round-trip).
  const [terminal, setTerminal] = useState<Terminal | null>(null)
  if (!terminal && (decision === 'owner' || decision === 'inactive' || decision === 'ended')) setTerminal(decision)

  // The owner account, a paused account or a revoked session: end this
  // browser's session at once (local scope; see session.ts). Runs once.
  useEffect(() => {
    if (terminal) void signOutStudio(queryClient)
  }, [terminal, queryClient])

  useEffect(() => {
    if (terminal) return
    if (decision === 'login') void navigate({ to: '/login', replace: true })
    else if (decision === 'mfa') void navigate({ to: '/login/mfa', replace: true })
  }, [decision, terminal, navigate])

  if (terminal) {
    const message = terminal === 'owner' ? t('login.ownerAccount') : terminal === 'inactive' ? t('guard.inactive') : t('guard.ended')
    return (
      <StudioFrame title={title}>
        <div role="alert" className="flex flex-col items-start gap-4 rounded-xl border border-line bg-surface p-4">
          <p className="m-0">{message}</p>
          <ButtonLink to="/login" variant="primary">
            {terminal === 'ended' ? t('guard.signInAgain') : t('guard.signInClub')}
          </ButtonLink>
        </div>
      </StudioFrame>
    )
  }
  if (access.phase === 'error') {
    return (
      <StudioFrame title={title}>
        <ErrorState error={access.error} onRetry={access.retry} />
      </StudioFrame>
    )
  }
  if (access.phase === 'ready' && access.decision === 'ok') {
    return (
      <>
        {children({ status: access.status, session: access.session })}
        <IdleSignOut enabled />
      </>
    )
  }
  return (
    <StudioFrame title={title}>
      <Spinner />
    </StudioFrame>
  )
}
