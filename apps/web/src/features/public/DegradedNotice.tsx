import { useTranslation } from 'react-i18next'

/** Shown instead of "no events" when the owner has switched public reads
 * off (quota-attack runbook): the events exist, they're just hidden for now. */
export function DegradedNotice() {
  const { t } = useTranslation('dashboard')
  return (
    <div className="mt-6 rounded-xl border border-accent/50 bg-accent/10 p-4">
      <p className="m-0 font-semibold">{t('degraded.title')}</p>
      <p className="m-0 mt-1 text-sm text-muted">{t('degraded.body')}</p>
    </div>
  )
}
