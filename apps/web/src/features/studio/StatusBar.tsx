import { useTranslation } from 'react-i18next'
import { currentLang } from '../../lib/i18n.ts'
import type { OkStatus } from '../../lib/session.ts'
import { statusBarItems, statusBarParts } from './statusBar.ts'
import { useNow } from './useNow.ts'

/** "Live 12/15 · New in last 24 h 3/5 · next slot 14:20" (MYT). */
export function StatusBar({ status }: { status: OkStatus }) {
  const { t } = useTranslation('studio')
  const now = useNow()
  const parts = statusBarParts(status, now, currentLang())
  const items = statusBarItems(t, parts)
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={t('status.label')} className="m-0 flex list-none flex-wrap gap-x-2 gap-y-1 p-0 text-sm">
        {items.map((text, i) => (
          <li key={text} className="inline-flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
            ) : null}
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {parts.edits.full ? (
        <p className="m-0 text-sm text-danger">{t('status.editsFull', { used: parts.edits.used, limit: parts.edits.limit })}</p>
      ) : null}
    </div>
  )
}
