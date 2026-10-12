import { useId } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { OkStatus } from '../../lib/session.ts'
import { ContactLink } from '../../features/studio/ContactLink.tsx'
import { StudioFrame } from '../../features/studio/StudioFrame.tsx'
import { StudioGuard } from '../../features/studio/StudioGuard.tsx'

/** /studio/settings — password help. */
export function SettingsPage() {
  const { t } = useTranslation('studio')
  return <StudioGuard title={t('settings.title')}>{({ status }) => <SettingsContent status={status} />}</StudioGuard>
}

function SettingsContent({ status }: { status: OkStatus }) {
  const { t } = useTranslation('studio')
  const ids = useId()

  return (
    <StudioFrame title={t('settings.title')} orgName={status.org.name}>
      <div className="flex max-w-2xl flex-col gap-8">
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
