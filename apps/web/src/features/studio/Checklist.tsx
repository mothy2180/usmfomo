import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx.ts'
import { markVisited, readVisited, type OnboardingStep } from './onboarding.ts'

/** First-login checklist: rules, first post. Each step ticks once its page
 * has been opened (or the thing is done); the checklist goes away by itself
 * when both are ticked. */
export function FirstLoginChecklist({ username, hasPosts }: { username: string; hasPosts: boolean }) {
  const { t } = useTranslation('studio')
  const titleId = useId()
  const [visited, setVisited] = useState(() => readVisited(username))

  const items: { key: OnboardingStep; done: boolean; to: '/rules' | '/studio/new'; label: string }[] = [
    { key: 'rules', done: visited.has('rules'), to: '/rules', label: t('checklist.rules') },
    { key: 'first', done: visited.has('first') || hasPosts, to: '/studio/new', label: t('checklist.firstPost') },
  ]
  if (items.every((i) => i.done)) return null

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
            <Link
              to={item.to}
              onClick={() => {
                markVisited(username, item.key)
                setVisited(readVisited(username))
              }}
              className={cx('inline-flex min-h-11 items-center underline', item.done ? 'text-muted' : 'text-sky')}
            >
              {item.label}
              {item.done ? <span className="sr-only"> {t('checklist.done')}</span> : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
