import { imageUrl } from '@usmfomo/shared/images'
import { formatEventRange } from '@usmfomo/shared/time'
import { useId } from 'react'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { Badge, Button, type Tone } from '../../components/ui.tsx'
import { PUBLIC_SITE_URL, SUPABASE_URL } from '../../env.ts'
import { formatMytDateTime } from '../../lib/format.ts'
import { CAMPUS_LABELS, TYPE_LABELS } from '../../lib/labels.ts'
import { postStatus, POST_STATUS_LABELS, type PostStatus } from '../../lib/posts.ts'
import type { ModPost } from '../../lib/queries.ts'
import { publicEventUrl, publicOrgUrl } from '../../lib/siteUrl.ts'
import type { PostAction } from './PostActionDialog.tsx'

const STATUS_TONES: Record<PostStatus, Tone> = { live: 'ok', cancelled: 'accent', hidden: 'danger', expired: 'neutral' }

/** Poster files are read straight from the public bucket (the console has no image proxy). */
const fileUrl = (path: string | null) => (path ? imageUrl(path, 'direct', SUPABASE_URL) : null)

export function PostCard({ post, now, onAction }: { post: ModPost; now: Date; onAction: (action: PostAction) => void }) {
  const titleId = useId()
  const status = postStatus(post, now)
  const thumb = fileUrl(post.thumb_path)
  const poster = fileUrl(post.poster_path)
  // Visually hidden context, so each card's buttons have distinct names.
  const which = <span className="sr-only"> “{post.title}”</span>

  return (
    <li>
      <article aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:flex-row">
        {thumb ? (
          <a href={poster ?? thumb} target="_blank" rel="noopener noreferrer" className="shrink-0 self-start">
            <img
              src={thumb}
              alt={`Poster of “${post.title}” (full size, opens in a new tab)`}
              width={96}
              height={128}
              loading="lazy"
              decoding="async"
              className="block h-32 w-24 rounded-lg border border-line bg-surface-2 object-cover"
            />
          </a>
        ) : (
          <p className="m-0 flex h-32 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-center text-xs text-muted">
            No poster
          </p>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="m-0 min-w-0 break-words text-base font-semibold">
              {post.title}
            </h2>
            <Badge tone={STATUS_TONES[status]}>{POST_STATUS_LABELS[status]}</Badge>
            {post.cancelled_at && status !== 'cancelled' ? <Badge tone="accent">Cancelled</Badge> : null}
          </div>
          <p className="m-0 text-sm">
            {post.org ? (
              <a href={publicOrgUrl(PUBLIC_SITE_URL, post.org.slug)} target="_blank" rel="noopener noreferrer" className="text-sky underline">
                {post.org.name}
              </a>
            ) : (
              'Unknown organisation'
            )}
            {post.org ? ` · ${TYPE_LABELS[post.org.type]}` : ''}
            {post.org && !post.org.active ? ' · organisation inactive' : ''} · {CAMPUS_LABELS[post.campus]} campus
          </p>
          <p className="m-0 text-sm">
            <time dateTime={post.starts_at}>{formatEventRange(post.starts_at, post.ends_at)}</time>
            <span className="text-muted"> · </span>
            <span className="break-words">{post.venue}</span>
          </p>
          {post.description ? <p className="m-0 whitespace-pre-line break-words text-sm text-muted">{post.description}</p> : null}
          {post.link_url ? (
            <p className="m-0 text-sm">
              <ExternalLink href={post.link_url}>Registration link</ExternalLink>
            </p>
          ) : null}
          <p className="m-0 text-xs text-muted">
            Posted {formatMytDateTime(post.created_at)}
            {post.updated_at !== post.created_at ? ` · edited ${formatMytDateTime(post.updated_at)}` : ''}
            {post.hidden_at ? ` · hidden ${formatMytDateTime(post.hidden_at)}` : ''}
            {post.cancelled_at ? ` · cancelled ${formatMytDateTime(post.cancelled_at)}` : ''}
          </p>
          {status === 'expired' ? (
            <p className="m-0 text-xs text-muted">Ended: the hourly clean-up deletes it and its files.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {status !== 'expired' ? (
              post.hidden_at ? (
                <Button onClick={() => onAction('unhide')}>Unhide{which}</Button>
              ) : (
                <Button onClick={() => onAction('hide')}>Hide{which}</Button>
              )
            ) : null}
            {post.poster_path ? <Button onClick={() => onAction('remove_image')}>Remove image{which}</Button> : null}
            <Button variant="danger" onClick={() => onAction('delete')}>
              Delete{which}
            </Button>
            <a
              href={publicEventUrl(PUBLIC_SITE_URL, post.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center px-2 text-sm text-sky underline"
            >
              Public page{which}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </article>
    </li>
  )
}
