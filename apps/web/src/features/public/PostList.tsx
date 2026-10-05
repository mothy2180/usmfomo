import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState } from '../../components/ui.tsx'
import { CardSkeletons } from './CardSkeletons.tsx'
import { flattenPages, totalOf } from './paging.ts'
import { PostSections } from './PostSections.tsx'
import type { usePostSearch } from './queries.ts'
import { groupIntoSections } from './sections.ts'

type Props = {
  query: ReturnType<typeof usePostSearch>
  now: Date
  idPrefix: string
  /** Shown when the list is empty. */
  empty: ReactNode
  layout?: 'list' | 'grid'
}

/** Loading, error, empty and list states of one search_posts list, with
 * "Show more" paging. */
export function PostList({ query, now, idPrefix, empty, layout }: Props) {
  const { t } = useTranslation('dashboard')
  const rootRef = useRef<HTMLDivElement>(null)
  // Cards on screen when "Show more" was pressed (null = not loading more).
  const shownBefore = useRef<ReadonlySet<string> | null>(null)

  const pages = useMemo(() => query.data?.pages ?? [], [query.data])
  const posts = useMemo(() => flattenPages(pages), [pages])
  const loadingMore = query.isFetchingNextPage

  // Keyboard focus must not fall back to <body> when the button is disabled
  // while loading or disappears after the last page: move it to the first new
  // card, or back to the button if nothing new arrived (e.g. the load failed).
  // Only when focus is lost or still in this list, never away from elsewhere.
  useEffect(() => {
    const before = shownBefore.current
    const root = rootRef.current
    if (!before || loadingMore || !root) return
    shownBefore.current = null
    const active = document.activeElement
    if (active && active !== document.body && !root.contains(active)) return
    const first = posts.find((p) => !before.has(p.id))
    const target = first
      ? root.querySelector<HTMLElement>(`[data-post-id="${first.id}"] .card-link`)
      : root.querySelector<HTMLElement>('[data-show-more]')
    target?.focus()
  }, [posts, loadingMore])

  if (query.isPending) return <CardSkeletons label={t('panel.loading')} />
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const sections = groupIntoSections(posts, now)
  if (sections.length === 0) return <>{empty}</>

  const total = Math.max(totalOf(pages), posts.length)
  const showMore = () => {
    shownBefore.current = new Set(posts.map((p) => p.id))
    void query.fetchNextPage()
  }
  return (
    <div ref={rootRef} className="flex flex-col gap-4" aria-busy={query.isPlaceholderData || undefined}>
      <PostSections sections={sections} now={now} idPrefix={idPrefix} layout={layout} />
      <div className="flex flex-col items-start gap-2">
        {total > posts.length ? (
          <p className="m-0 text-sm text-muted" aria-live="polite">
            {t('panel.showing', { shown: posts.length, total })}
          </p>
        ) : null}
        {/* A failed "Show more" keeps the button (it retries), so focus stays put. */}
        {query.isFetchNextPageError ? <ErrorState error={query.error} /> : null}
        {query.hasNextPage ? (
          <Button data-show-more="" onClick={showMore} busy={loadingMore}>
            {t('panel.showMore')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
