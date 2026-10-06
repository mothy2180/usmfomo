import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ErrorState, Spinner } from '../../components/ui.tsx'
import { STUDIO_QUERY_KEY, type OkStatus } from '../../lib/session.ts'
import { AddDevice } from '../../features/studio/AddDevice.tsx'
import { ContactLink } from '../../features/studio/ContactLink.tsx'
import { DeviceList } from '../../features/studio/DeviceList.tsx'
import { listDevices } from '../../features/studio/mfa.ts'
import { StudioFrame } from '../../features/studio/StudioFrame.tsx'
import { StudioGuard } from '../../features/studio/StudioGuard.tsx'
import { useNow } from '../../features/studio/useNow.ts'

/** /studio/settings — 2FA devices (one per committee member) and password help. */
export function SettingsPage() {
  const { t } = useTranslation('studio')
  return (
    <StudioGuard title={t('settings.title')}>
      {({ status, session }) => <SettingsContent status={status} userId={session.user.id} />}
    </StudioGuard>
  )
}

function SettingsContent({ status, userId }: { status: OkStatus; userId: string }) {
  const { t } = useTranslation('studio')
  const ids = useId()
  const now = useNow()
  const [message, setMessage] = useState('')
  const devices = useQuery({
    queryKey: [...STUDIO_QUERY_KEY, 'devices', userId],
    queryFn: listDevices,
    // A half-finished setup must not be reset by a background refetch.
    refetchOnWindowFocus: false,
  })
  const verified = devices.data?.verified ?? []
  const devicesHeadingRef = useRef<HTMLHeadingElement>(null)
  // A removed device's Remove button (focused again as the dialog closes)
  // goes away when the list reloads: then focus the Devices heading.
  const removedRef = useRef<string | null>(null)

  useEffect(() => {
    const id = removedRef.current
    if (id === null || (!devices.isError && (devices.data?.verified ?? []).some((d) => d.id === id))) return
    removedRef.current = null
    devicesHeadingRef.current?.focus()
  }, [devices.data, devices.isError])

  return (
    <StudioFrame title={t('settings.title')} orgName={status.org.name}>
      <div className="flex max-w-2xl flex-col gap-8">
        <section aria-labelledby={`${ids}-mfa`} className="flex flex-col gap-3">
          <h2 id={`${ids}-mfa`} className="m-0 text-lg font-bold">
            {t('settings.mfaTitle')}
          </h2>
          <p className="m-0 text-sm">{t('settings.mfaIntro')}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            <li>{t('settings.how1')}</li>
            <li>{t('settings.how2')}</li>
            <li>{t('settings.othersSignedOut')}</li>
            <li>{t('settings.how3')}</li>
          </ul>
        </section>

        {/* Always rendered: a live region must exist before its text changes. */}
        <p aria-live="polite" className="m-0 text-sm font-semibold text-ok">
          {message}
        </p>

        <section aria-labelledby={`${ids}-devices`} className="flex flex-col gap-3">
          <h2 id={`${ids}-devices`} ref={devicesHeadingRef} tabIndex={-1} className="m-0 text-lg font-bold">
            {t('settings.devicesTitle')}
          </h2>
          {devices.isPending ? (
            <Spinner />
          ) : devices.isError ? (
            <ErrorState message={t('settings.loadError')} onRetry={() => void devices.refetch()} />
          ) : (
            <>
              {verified.length === 1 ? (
                <p className="m-0 rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm font-semibold">{t('settings.oneDeviceWarning')}</p>
              ) : null}
              <DeviceList
                devices={verified}
                now={now}
                onRemoved={({ id, name }) => {
                  removedRef.current = id
                  setMessage(t('settings.removed', { name }))
                }}
              />
            </>
          )}
        </section>

        <section aria-labelledby={`${ids}-add`} className="flex flex-col gap-3">
          <h2 id={`${ids}-add`} className="m-0 text-lg font-bold">
            {t('settings.addTitle')}
          </h2>
          <AddDevice existing={verified} onAdded={(name) => setMessage(t('settings.addedDevice', { name }))} />
        </section>

        <section aria-labelledby={`${ids}-password`} className="flex flex-col gap-3">
          <h2 id={`${ids}-password`} className="m-0 text-lg font-bold">
            {t('settings.passwordTitle')}
          </h2>
          <p className="m-0 text-sm">
            <Trans t={t} i18nKey="settings.passwordBody" components={{ contact: <ContactLink /> }} />
          </p>
        </section>
      </div>
    </StudioFrame>
  )
}
