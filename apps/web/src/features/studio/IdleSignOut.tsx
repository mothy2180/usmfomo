import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { formatCountdown, useIdleTimeout } from '../../lib/idle.ts'
import { noteIdleSignOut, signOutStudio } from '../../lib/session.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

/**
 * Signs this browser out of the studio (local scope) after 30 minutes without
 * input, for shared lab PCs, then /login says why. A warning comes two
 * minutes before; any key, click or "Stay signed in" (also Escape) keeps the
 * session (WCAG 2.2.1).
 */
export function IdleSignOut({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('studio')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const signOut = async (idle: boolean) => {
    if (idle) noteIdleSignOut()
    await signOutStudio(queryClient)
    void navigate({ to: '/login', replace: true })
  }
  const { state, stayActive } = useIdleTimeout({ enabled, onExpire: () => void signOut(true) })
  const warning = state.phase === 'warning'

  return (
    <ConfirmDialog
      open={warning}
      title={t('idle.title')}
      body={<p className="m-0">{t('idle.body', { time: warning ? formatCountdown(state.remainingMs) : '' })}</p>}
      confirmLabel={t('idle.signOutNow')}
      cancelLabel={t('idle.stay')}
      onConfirm={() => void signOut(false)}
      onCancel={stayActive}
    />
  )
}
