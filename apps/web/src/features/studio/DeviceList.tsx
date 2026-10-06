import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button } from '../../components/ui.tsx'
import { currentLang } from '../../lib/i18n.ts'
import { STUDIO_QUERY_KEY } from '../../lib/session.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { studioErrorKey } from './errorMessage.ts'
import { formatAddedDate, isRecentFactor, type TotpFactor } from './factors.ts'
import { removeDevice } from './mfa.ts'

type Props = {
  devices: TotpFactor[]
  now: Date
  /** Called after a device was removed (the list reloads afterwards). */
  onRemoved: (removed: { id: string; name: string }) => void
}

/** Verified 2FA devices with "Remove" (needs an aal2 session). */
export function DeviceList({ devices, now, onRemoved }: Props) {
  const { t } = useTranslation('studio')
  const lang = currentLang()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<TotpFactor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameOf = (f: TotpFactor) => f.friendly_name || t('settings.unnamed')

  if (devices.length === 0) return <p className="m-0 text-sm text-muted">{t('settings.noDevices')}</p>

  const anyRecent = devices.some((d) => isRecentFactor(d.created_at, now))
  const isLast = devices.length === 1

  const confirmRemove = async () => {
    if (!target || busy) return
    setBusy(true)
    setError(null)
    try {
      await removeDevice(target.id)
      setTarget(null)
      onRemoved({ id: target.id, name: nameOf(target) })
    } catch (err) {
      const key = studioErrorKey(err)
      if (key === 'errors:mfa_required') {
        // This session hasn't passed 2FA (Auth says insufficient_aal).
        setTarget(null)
        void navigate({ to: '/login/mfa' })
        return
      }
      setError(t(key))
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: STUDIO_QUERY_KEY })
    }
  }

  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {devices.map((d) => {
          const name = nameOf(d)
          const recent = isRecentFactor(d.created_at, now)
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="m-0 font-semibold break-words">{name}</p>
                <p className="m-0 text-sm text-muted">{t('settings.added', { date: formatAddedDate(d.created_at, lang) })}</p>
                {recent ? (
                  <p className="m-0">
                    <Badge tone="accent">{t('settings.recent')}</Badge>
                  </p>
                ) : null}
              </div>
              <Button
                variant="danger"
                onClick={() => {
                  setError(null)
                  setTarget(d)
                }}
              >
                {t('settings.remove')}
                <span className="sr-only">: {name}</span>
              </Button>
            </li>
          )
        })}
      </ul>
      {anyRecent ? <p className="m-0 text-sm text-muted">{t('settings.recentHint')}</p> : null}
      <ConfirmDialog
        open={target !== null}
        title={t('settings.removeTitle', { name: target ? nameOf(target) : '' })}
        body={
          <>
            <p className="m-0">{t('settings.removeBody')}</p>
            <p className="mt-2 mb-0">{isLast ? t('settings.removeLastBody') : t('settings.removeOwnHint')}</p>
          </>
        }
        confirmLabel={t('settings.removeConfirm')}
        cancelLabel={t('common:actions.cancel')}
        busy={busy}
        error={error}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setTarget(null)}
      />
    </>
  )
}
