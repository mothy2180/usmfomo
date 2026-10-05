import { formatDay } from '@usmfomo/shared/time'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui.tsx'
import { cx } from '../../lib/cx.ts'
import { currentLang } from '../../lib/i18n.ts'
import type { CardBadge } from './badges.ts'

export function EventBadges({ badges, className }: { badges: readonly CardBadge[]; className?: string }) {
  const { t } = useTranslation('dashboard')
  if (badges.length === 0) return null
  const lang = currentLang()
  return (
    <p className={cx('m-0 flex flex-wrap gap-1.5', className)}>
      {badges.map((badge) => {
        switch (badge.kind) {
          case 'cancelled':
            return (
              <Badge key="cancelled" tone="danger">
                {t('common:time.cancelled')}
              </Badge>
            )
          case 'now':
            return (
              <Badge key="now" tone="ok">
                {t('common:time.happeningNow')}
              </Badge>
            )
          case 'onUntil':
            return (
              <Badge key="onUntil" tone="sky">
                {t('common:time.onUntil', { day: formatDay(badge.until, lang) })}
              </Badge>
            )
          case 'updated':
            return (
              <Badge key="updated" tone="accent">
                {t('common:time.updated')}{' '}
                <span className="sr-only">{t('badges.updatedHint')}</span>
              </Badge>
            )
        }
      })}
    </p>
  )
}
