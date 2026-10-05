import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui.tsx'
import { cx } from '../../lib/cx.ts'

// Per-browser convenience only (remembered in localStorage per account).
const keyFor = (username: string) => `usmfomo.studio.checklistDismissed.${username}`

function readDismissed(username: string): boolean {
  try {
    return window.localStorage.getItem(keyFor(username)) === '1'
  } catch {
    return false
  }
}

function saveDismissed(username: string): void {
  try {
    window.localStorage.setItem(keyFor(username), '1')
  } catch {
    // storage blocked: the checklist simply shows again next time
  }
}

/** First-login checklist: rules, 2FA per committee member, first post. */
export function FirstLoginChecklist({
  username,
  hasFactors,
  hasPosts,
  onDismiss,
}: {
  username: string
  hasFactors: boolean
  hasPosts: boolean
  /** Move focus somewhere sensible: the dismiss button disappears. */
  onDismiss?: () => void
}) {
  const { t } = useTranslation('studio')
  const titleId = useId()
  const [dismissed, setDismissed] = useState(() => readDismissed(username))
  if (dismissed) return null

  const items = [
    { key: 'rules', done: false, to: '/rules' as const, label: t('checklist.rules') },
    { key: 'mfa', done: hasFactors, to: '/studio/settings' as const, label: t('checklist.mfa') },
    { key: 'first', done: hasPosts, to: '/studio/new' as const, label: t('checklist.firstPost') },
  ]

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-sky/40 bg-sky/5 p-4">
      <h2 id={titleId} className="m-0 text-base font-bold">
        {t('checklist.title')}
      </h2>
      <ol className="mt-3 mb-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cx(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                item.done ? 'border-ok bg-ok/15 text-ok' : 'border-line text-muted',
              )}
            >
              {item.done ? '✓' : ''}
            </span>
            <Link to={item.to} className={cx('inline-flex min-h-11 items-center underline', item.done ? 'text-muted' : 'text-sky')}>
              {item.label}
              {item.done ? <span className="sr-only"> {t('checklist.done')}</span> : null}
            </Link>
          </li>
        ))}
      </ol>
      <Button
        variant="ghost"
        className="mt-2"
        onClick={() => {
          saveDismissed(username)
          setDismissed(true)
          onDismiss?.()
        }}
      >
        {t('checklist.dismiss')}
      </Button>
    </section>
  )
}
