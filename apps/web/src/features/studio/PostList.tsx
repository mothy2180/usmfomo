import { useQueryClient } from '@tanstack/react-query'
import { formatEventRange } from '@usmfomo/shared/time'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, ButtonLink } from '../../components/ui.tsx'
import { imageSrc, onImageError } from '../../lib/db.ts'
import { currentLang } from '../../lib/i18n.ts'
import { STUDIO_QUERY_KEY } from '../../lib/session.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { studioErrorKey } from './errorMessage.ts'
import { isEditable, isPubliclyVisible, postLabels } from './postLabels.ts'
import { studioPorts } from './ports.ts'
import { deletePost } from './submitPost.ts'
import type { PostRow } from './types.ts'
import { useNow } from './useNow.ts'

type Props = {
  posts: PostRow[]
  /** Set when editing is unavailable (paused / edit limit): id of the reason text. */
  editBlockedBy: string | null
  onDeleted: (title: string) => void
}

type ItemProps = { post: PostRow; now: Date; editBlockedBy: string | null; onDelete: () => void }

function PostItem({ post, now, editBlockedBy, onDelete }: ItemProps) {
  const { t } = useTranslation('studio')
  const lang = currentLang()
  const labels = postLabels(post, now)
  const editable = isEditable(post, now)
  const visible = isPubliclyVisible(post, now)
  const thumb = imageSrc(post.thumb_path)
  const sr = <span className="sr-only">: {post.title}</span>

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex gap-4">
        {thumb ? (
          <img
            src={thumb}
            onError={(e) => onImageError(e, post.thumb_path)}
            alt={t('posts.posterAlt', { title: post.title })}
            loading="lazy"
            className="h-28 w-20 shrink-0 rounded-lg bg-ink object-cover"
          />
        ) : (
          <div aria-hidden="true" className="h-28 w-20 shrink-0 rounded-lg border border-line bg-surface-2" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="m-0 text-base font-semibold break-words">{post.title}</h3>
          <p className="m-0 text-sm text-muted">{formatEventRange(post.starts_at, post.ends_at, lang)}</p>
          <p className="m-0 text-sm break-words text-muted">
            {post.venue} · {t(`common:campus.${post.campus}`)}
          </p>
          <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
            {labels.map(({ label, tone }) => (
              <li key={label}>
                <Badge tone={tone}>{t(`posts.${label}`)}</Badge>
              </li>
            ))}
          </ul>
          {post.hidden_at ? <p className="m-0 mt-1 text-sm text-muted">{t('posts.hiddenNote')}</p> : null}
          {!editable ? <p className="m-0 mt-1 text-sm text-muted">{t('posts.endedNote')}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {editable ? (
          editBlockedBy ? (
            <Button disabled aria-describedby={editBlockedBy}>
              {t('posts.edit')}
              {sr}
            </Button>
          ) : (
            <ButtonLink to="/studio/$id/edit" params={{ id: post.id }}>
              {t('posts.edit')}
              {sr}
            </ButtonLink>
          )
        ) : null}
        <Button variant="danger" onClick={onDelete}>
          {t('posts.delete')}
          {sr}
        </Button>
        {visible ? (
          <ButtonLink to="/e/$id" params={{ id: post.id }} variant="ghost">
            {t('posts.view')}
            {sr}
          </ButtonLink>
        ) : null}
      </div>
    </li>
  )
}

/** The club's own posts with Edit / Delete / View public page. */
export function PostList({ posts, editBlockedBy, onDeleted }: Props) {
  const { t } = useTranslation('studio')
  const queryClient = useQueryClient()
  const now = useNow()
  const [target, setTarget] = useState<PostRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!target || busy) return
    setBusy(true)
    setError(null)
    try {
      await deletePost(studioPorts, target)
      const title = target.title
      setTarget(null)
      onDeleted(title)
    } catch (err) {
      setError(t(studioErrorKey(err)))
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: STUDIO_QUERY_KEY })
    }
  }

  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {posts.map((post) => (
          <PostItem
            key={post.id}
            post={post}
            now={now}
            editBlockedBy={editBlockedBy}
            onDelete={() => {
              setError(null)
              setTarget(post)
            }}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={target !== null}
        title={t('posts.deleteTitle')}
        body={<p className="m-0">{t('posts.deleteBody', { title: target?.title ?? '' })}</p>}
        confirmLabel={t('posts.deleteConfirm')}
        cancelLabel={t('posts.keep')}
        busy={busy}
        error={error}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setTarget(null)}
      />
    </>
  )
}
