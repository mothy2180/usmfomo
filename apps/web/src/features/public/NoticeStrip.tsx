import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { cx } from '../../lib/cx.ts'
import { dismissKey, isDismissed, pruneDismissed, rememberDismissed } from './noticeStorage.ts'
import type { Notice } from './types.ts'

/** Notices shown before "More notices (n)". */
export const NOTICES_EXPANDED = 2

type Props = {
  notices: readonly Notice[]
  now: Date
  /** Called after the last visible notice is dismissed (move focus elsewhere). */
  onAllDismissed?: () => void
}

/**
 * Owner announcements above the events, styled apart from event cards.
 * Hidden when nothing is live or everything has been dismissed.
 */
export function NoticeStrip({ notices, now, onAllDismissed }: Props) {
  const { t } = useTranslation('dashboard')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const restId = useId()
  const [showAll, setShowAll] = useState(false)
  // Dismissals from this visit, so they stick even when storage is blocked.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    pruneDismissed(notices)
  }, [notices])

  const nowMs = now.getTime()
  const visible = notices.filter(
    (n) => Date.parse(n.starts_at) <= nowMs && Date.parse(n.ends_at) > nowMs && !hidden.has(dismissKey(n)) && !isDismissed(n),
  )
  if (visible.length === 0) return null

  const dismiss = (notice: Notice) => {
    rememberDismissed(notice)
    setHidden((prev) => new Set(prev).add(dismissKey(notice)))
    if (visible.length > 1) headingRef.current?.focus()
    else onAllDismissed?.()
  }

  const first = visible.slice(0, NOTICES_EXPANDED)
  const rest = visible.slice(NOTICES_EXPANDED)
  return (
    <section aria-labelledby={`${restId}-heading`} className="mt-4">
      <h2 ref={headingRef} id={`${restId}-heading`} tabIndex={-1} className="m-0 mb-2 text-xs font-bold uppercase tracking-wide text-accent">
        {t('notices.heading')}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {first.map((n) => (
          <NoticeItem key={dismissKey(n)} notice={n} onDismiss={dismiss} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <>
          {/* Disclosure: the button comes first, the extra notices follow it. */}
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls={`${restId}-rest`}
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 min-h-8 rounded px-1 text-sm font-semibold text-accent underline underline-offset-2"
          >
            {showAll ? t('notices.fewer') : t('notices.more', { count: rest.length })}
          </button>
          <ul id={`${restId}-rest`} hidden={!showAll} className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {rest.map((n) => (
              <NoticeItem key={dismissKey(n)} notice={n} onDismiss={dismiss} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function NoticeItem({ notice, onDismiss }: { notice: Notice; onDismiss: (n: Notice) => void }) {
  const { t } = useTranslation('dashboard')
  const bodyId = useId()
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  // "Read more" only when the 3-line clamp actually cuts the text; re-measured
  // on resize and when a hidden notice is revealed.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || expanded) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [expanded, notice.body])

  return (
    <li className="relative rounded-xl border border-accent/40 border-l-4 border-l-accent bg-accent/10 py-3 pl-4 pr-14">
      <h3 className="m-0 text-base font-semibold wrap-anywhere">{notice.title}</h3>
      <p ref={bodyRef} id={bodyId} className={cx('m-0 mt-1 whitespace-pre-line text-sm wrap-anywhere', !expanded && 'line-clamp-3')}>
        {notice.body}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {overflows || expanded ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((v) => !v)}
            className="min-h-8 rounded px-1 font-semibold text-accent underline underline-offset-2"
          >
            {expanded ? t('notices.readLess') : t('notices.readMore')}
          </button>
        ) : null}
        {notice.link_url ? <ExternalLink href={notice.link_url}>{t('notices.link')}</ExternalLink> : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(notice)}
        aria-label={t('notices.dismiss', { title: notice.title })}
        className="absolute right-1.5 top-1.5 inline-flex size-11 items-center justify-center rounded-lg text-xl leading-none text-muted hover:bg-surface-2 hover:text-text"
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  )
}
