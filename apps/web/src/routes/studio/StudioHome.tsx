import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ButtonLink, EmptyState, ErrorState, Spinner } from '../../components/ui.tsx'
import { currentLang } from '../../lib/i18n.ts'
import { STUDIO_QUERY_KEY, type OkStatus } from '../../lib/session.ts'
import { FirstLoginChecklist } from '../../features/studio/Checklist.tsx'
import { PostList } from '../../features/studio/PostList.tsx'
import { fetchOwnPosts } from '../../features/studio/ports.ts'
import { StatusBar } from '../../features/studio/StatusBar.tsx'
import { editBlock, newPostBlockText } from '../../features/studio/statusBar.ts'
import { StudioFrame } from '../../features/studio/StudioFrame.tsx'
import { StudioGuard } from '../../features/studio/StudioGuard.tsx'
import { useNow } from '../../features/studio/useNow.ts'

/** /studio — status, limits, the club's posts. */
export function StudioHome() {
  const { t } = useTranslation('studio')
  return <StudioGuard title={t('home.title')}>{({ status }) => <StudioHomeContent status={status} />}</StudioGuard>
}

function StudioHomeContent({ status }: { status: OkStatus }) {
  const { t } = useTranslation('studio')
  const ids = useId()
  const now = useNow()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [deletedTitle, setDeletedTitle] = useState<string | null>(null)
  const posts = useQuery({
    queryKey: [...STUDIO_QUERY_KEY, 'posts', status.org.id],
    queryFn: () => fetchOwnPosts(status.org.id),
  })

  // After a delete the item (and its button) is gone: keep focus nearby.
  useEffect(() => {
    if (deletedTitle) headingRef.current?.focus()
  }, [deletedTitle])

  const blockText = newPostBlockText(t, status, now, currentLang())
  const editsBlocked = editBlock(status)
  const pausedId = `${ids}-paused`
  const editsId = `${ids}-edits`
  const editReason = editsBlocked === 'paused' ? pausedId : editsBlocked === 'edits' ? editsId : null

  return (
    <StudioFrame title={t('home.title')} orgName={status.org.name}>
      <div className="flex flex-col gap-6">
        <StatusBar status={status} />

        {!status.posting_enabled ? (
          <p id={pausedId} className="m-0 rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm font-semibold">
            {t('errors:posting_paused')}
          </p>
        ) : null}
        {editsBlocked === 'edits' ? (
          <p id={editsId} className="sr-only">
            {t('form.editsFull', { limit: status.edits_limit })}
          </p>
        ) : null}

        <FirstLoginChecklist
          username={status.username}
          hasFactors={status.factors > 0}
          hasPosts={(posts.data?.length ?? 0) > 0}
          onDismiss={() => headingRef.current?.focus()}
        />

        <div className="flex flex-wrap items-center gap-3">
          {blockText ? (
            <>
              <Button variant="primary" disabled aria-describedby={`${ids}-new`}>
                {t('home.newPost')}
              </Button>
              <p id={`${ids}-new`} className="m-0 text-sm text-muted">
                {blockText}
              </p>
            </>
          ) : (
            <ButtonLink to="/studio/new" variant="primary">
              {t('home.newPost')}
            </ButtonLink>
          )}
        </div>

        <section aria-labelledby={`${ids}-posts`} className="flex flex-col gap-3">
          <h2 id={`${ids}-posts`} ref={headingRef} tabIndex={-1} className="m-0 text-lg font-bold">
            {t('home.postsTitle')}
          </h2>
          {/* Always rendered: a live region must exist before its text changes. */}
          <p aria-live="polite" className="m-0 text-sm text-ok">
            {deletedTitle ? t('home.deleted', { title: deletedTitle }) : ''}
          </p>
          {posts.isPending ? (
            <Spinner />
          ) : posts.isError ? (
            <ErrorState message={t('home.loadError')} onRetry={() => void posts.refetch()} />
          ) : posts.data.length === 0 ? (
            <EmptyState title={t('home.empty')}>{t('home.emptyHint')}</EmptyState>
          ) : (
            <PostList posts={posts.data} editBlockedBy={editReason} onDeleted={setDeletedTitle} />
          )}
        </section>
      </div>
    </StudioFrame>
  )
}
