import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ButtonLink, ErrorState, Spinner } from '../../components/ui.tsx'
import { STUDIO_QUERY_KEY, type OkStatus } from '../../lib/session.ts'
import { PostForm } from '../../features/studio/PostForm.tsx'
import { isEditable } from '../../features/studio/postLabels.ts'
import { fetchOwnPost } from '../../features/studio/ports.ts'
import { editBlock } from '../../features/studio/statusBar.ts'
import { StatusBar } from '../../features/studio/StatusBar.tsx'
import { StudioFrame } from '../../features/studio/StudioFrame.tsx'
import { StudioGuard } from '../../features/studio/StudioGuard.tsx'
import { useLatch } from '../../features/studio/useLatch.ts'
import { useNow } from '../../features/studio/useNow.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** /studio/$id/edit */
export function EditPostPage() {
  const { t } = useTranslation('studio')
  const { id } = useParams({ from: '/studio/$id/edit' })
  return <StudioGuard title={t('form.editTitle')}>{({ status }) => <EditPostContent status={status} id={id} />}</StudioGuard>
}

function Notice({ text }: { text: string }) {
  const { t } = useTranslation('studio')
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="m-0 rounded-xl border border-line bg-surface p-4 text-sm">{text}</p>
      <ButtonLink to="/studio">{t('nav.backToStudio')}</ButtonLink>
    </div>
  )
}

function EditPostContent({ status, id }: { status: OkStatus; id: string }) {
  const { t } = useTranslation('studio')
  const now = useNow()
  const validId = UUID_RE.test(id)
  const post = useQuery({
    queryKey: [...STUDIO_QUERY_KEY, 'post', status.org.id, id],
    queryFn: () => fetchOwnPost(status.org.id, id),
    enabled: validId,
    // Don't overwrite a form that is being filled in when the tab regains focus.
    refetchOnWindowFocus: false,
  })
  const blocked = editBlock(status)
  // Once the form is up, keep it (and its "Saved" panel) even if this save
  // used the last edit or the event's end time passes meanwhile.
  const showForm = useLatch(Boolean(post.data && isEditable(post.data, now) && !blocked))

  let body
  if (!validId) body = <Notice text={t('form.notFound')} />
  else if (post.isPending) body = <Spinner />
  else if (post.isError && !post.data) body = <ErrorState error={post.error} onRetry={() => void post.refetch()} />
  else if (!post.data) body = <Notice text={t('form.notFound')} />
  else if (!showForm && !isEditable(post.data, now)) body = <Notice text={t('form.endedNoEdit')} />
  else if (!showForm && blocked === 'paused') body = <Notice text={`${t('errors:posting_paused')} ${t('form.pausedNoForm')}`} />
  else if (!showForm && blocked === 'edits') body = <Notice text={t('form.editsFull', { limit: status.edits_limit })} />
  else {
    body = (
      <div className="flex flex-col gap-4">
        {post.data.hidden_at ? (
          <p className="m-0 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm">{t('form.hiddenNote')}</p>
        ) : null}
        <PostForm key={post.data.id} org={status.org} post={post.data} postingEnabled={status.posting_enabled} />
      </div>
    )
  }

  return (
    <StudioFrame title={t('form.editTitle')} orgName={status.org.name}>
      <div className="flex max-w-2xl flex-col gap-6">
        <StatusBar status={status} />
        {body}
      </div>
    </StudioFrame>
  )
}
