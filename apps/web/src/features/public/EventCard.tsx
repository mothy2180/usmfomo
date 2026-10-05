import { Link } from '@tanstack/react-router'
import { formatEventRange } from '@usmfomo/shared/time'
import { useTranslation } from 'react-i18next'
import { currentLang } from '../../lib/i18n.ts'
import { badgesFor } from './badges.ts'
import { EventBadges } from './EventBadges.tsx'
import { EventCover } from './EventCover.tsx'
import { FallbackImage } from './FallbackImage.tsx'
import type { PostCard } from './types.ts'

const THUMB_PX = 96

/**
 * One event in a list. The title link is stretched over the whole card (its
 * ::after covers the article), so the card is one big link without nesting
 * the organiser link inside another <a>. The organiser link sits above it.
 */
export function EventCard({ post, now }: { post: PostCard; now: Date }) {
  const { t } = useTranslation('dashboard')
  const lang = currentLang()
  const org = { id: post.org_id, name: post.org_name, type: post.org_type }
  return (
    <article className="relative flex gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-sky/60 has-[.card-link:focus-visible]:border-sky">
      <div className="shrink-0">
        {/* alt="": the title and organiser next to it say the same thing. */}
        <FallbackImage
          paths={[post.thumb_path]}
          alt=""
          width={THUMB_PX}
          height={THUMB_PX}
          className="size-20 rounded-lg bg-surface-2 object-cover sm:size-24"
          fallback={<EventCover org={org} className="size-20 rounded-lg sm:size-24" />}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h4 className="m-0 text-base font-semibold leading-snug wrap-anywhere">
          <Link
            to="/e/$id"
            params={{ id: post.id }}
            className="card-link text-text no-underline after:absolute after:inset-0 after:rounded-xl hover:underline"
          >
            {post.title}
          </Link>
        </h4>
        <EventBadges badges={badgesFor(post, now)} />
        <p className="m-0 text-sm">
          <time dateTime={post.starts_at}>{formatEventRange(post.starts_at, post.ends_at, lang)}</time>
        </p>
        <p className="m-0 text-sm text-muted wrap-anywhere">{post.venue}</p>
        <p className="m-0 text-sm text-muted">
          <span className="sr-only">{t('card.organiser')} </span>
          {/* py-0.5: a 24 px tall target (WCAG 2.5.8), since it sits on the card link. */}
          <Link
            to="/o/$slug"
            params={{ slug: post.org_slug }}
            className="relative z-10 inline-block py-0.5 text-sky underline decoration-sky/40 underline-offset-2 hover:decoration-sky wrap-anywhere"
          >
            {post.org_name}
          </Link>
        </p>
      </div>
    </article>
  )
}
