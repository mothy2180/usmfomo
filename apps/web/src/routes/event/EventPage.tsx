import { Link, useParams } from '@tanstack/react-router'
import { formatDay, formatEventRange } from '@usmfomo/shared/time'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { ButtonLink, ErrorState, Spinner } from '../../components/ui.tsx'
import { currentLang } from '../../lib/i18n.ts'
import { badgesFor } from '../../features/public/badges.ts'
import { CalendarActions } from '../../features/public/CalendarActions.tsx'
import { DegradedNotice } from '../../features/public/DegradedNotice.tsx'
import { EventBadges } from '../../features/public/EventBadges.tsx'
import { EventCover } from '../../features/public/EventCover.tsx'
import { FallbackImage } from '../../features/public/FallbackImage.tsx'
import { useDocumentTitle, useNow } from '../../features/public/hooks.ts'
import { isUuid } from '../../features/public/ids.ts'
import { useEventPost, usePublicReadsEnabled } from '../../features/public/queries.ts'
import { pageUrl } from '../../features/public/share.ts'
import { ShareButton } from '../../features/public/ShareButton.tsx'
import type { EventDetail } from '../../features/public/types.ts'

/** /e/$id — one event. Ended, deleted and hidden posts all look the same
 * ("ended or removed"), so moderation is never revealed. */
export function EventPage() {
  const { id } = useParams({ from: '/e/$id' })
  const { t } = useTranslation('dashboard')
  const now = useNow()
  const query = useEventPost(id)
  const post = query.data
  const gone = !isUuid(id) || (query.isSuccess && (!post || Date.parse(post.ends_at) <= now.getTime()))
  const reads = usePublicReadsEnabled(gone && isUuid(id))

  useDocumentTitle(
    gone ? t('event.goneDocTitle') : post ? t('event.docTitle', { title: post.title }) : t('event.loadingDocTitle'),
  )

  return (
    <AppShell wide>
      <p className="m-0 mb-4 text-sm">
        <Link to="/dashboard" className="text-sky underline underline-offset-2">
          <span aria-hidden="true">← </span>
          {t('event.back')}
        </Link>
      </p>
      {gone ? (
        <Gone degraded={reads.data === false} />
      ) : query.isError ? (
        <>
          <h1 className="m-0 mb-4 text-2xl font-bold">{t('event.errorTitle')}</h1>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </>
      ) : post ? (
        <EventDetails post={post} now={now} />
      ) : (
        <>
          <h1 className="sr-only">{t('event.loadingDocTitle')}</h1>
          <Spinner />
        </>
      )}
    </AppShell>
  )
}

function Gone({ degraded }: { degraded: boolean }) {
  const { t } = useTranslation('dashboard')
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <h1 className="m-0 text-2xl font-bold">{t('event.goneTitle')}</h1>
      <p className="mb-4 mt-2 text-muted">{t('event.goneBody')}</p>
      <ButtonLink to="/dashboard" variant="primary">
        {t('event.goneCta')}
      </ButtonLink>
      {degraded ? <DegradedNotice /> : null}
    </div>
  )
}

function EventDetails({ post, now }: { post: EventDetail; now: Date }) {
  const { t } = useTranslation('dashboard')
  const lang = currentLang()
  const url = pageUrl(`/e/${post.id}`)
  const org = post.org
  const coverOrg = { id: post.org_id, name: org?.name ?? post.title, type: org?.type ?? 'club' }

  return (
    <article className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10">
      <div className="lg:order-2">
        <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight wrap-anywhere">{post.title}</h1>
        <EventBadges badges={badgesFor(post, now)} className="mt-3" />
        {post.cancelled_at ? (
          <p className="m-0 mt-4 rounded-lg border border-danger/50 bg-danger/10 p-3 text-sm font-semibold">{t('event.cancelledNote')}</p>
        ) : null}

        <dl className="m-0 mt-5 grid gap-4">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">{t('event.when')}</dt>
            <dd className="m-0 mt-1">
              <time dateTime={post.starts_at} className="text-lg font-semibold">
                {formatEventRange(post.starts_at, post.ends_at, lang)}
              </time>
              <span className="block text-sm text-muted">{t('common:time.mytNote')}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">{t('event.where')}</dt>
            <dd className="m-0 mt-1 wrap-anywhere">
              {post.venue}
              <span className="block text-sm text-muted">{t(`common:campus.${post.campus}`)}</span>
            </dd>
          </div>
          {org ? (
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-muted">{t('event.organiser')}</dt>
              <dd className="m-0 mt-1">
                <Link to="/o/$slug" params={{ slug: org.slug }} className="text-sky underline underline-offset-2 wrap-anywhere">
                  {org.name}
                </Link>
                <span className="block text-sm text-muted">{t(`common:orgType.${org.type}One`)}</span>
              </dd>
            </div>
          ) : null}
        </dl>

        {post.details_changed_at ? (
          <p className="m-0 mt-4 text-sm text-muted">{t('event.updatedNote', { day: formatDay(post.details_changed_at, lang) })}</p>
        ) : null}

        {post.description ? (
          <section aria-labelledby="event-about" className="mt-6">
            <h2 id="event-about" className="m-0 text-lg font-bold">
              {t('event.about')}
            </h2>
            {/* Club text exactly as typed: rendered as text, newlines kept. */}
            <p className="m-0 mt-2 whitespace-pre-line leading-relaxed wrap-anywhere">{post.description}</p>
          </section>
        ) : null}

        {post.link_url ? (
          <p className="m-0 mt-5">
            <ExternalLink href={post.link_url}>{t('event.link')}</ExternalLink>
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-start gap-2">
          {post.cancelled_at ? null : <CalendarActions post={post} pageUrl={url} />}
          <ShareButton url={url} title={post.title} />
        </div>
      </div>

      <div className="lg:order-1">
        <FallbackImage
          paths={[post.poster_path, post.thumb_path]}
          alt={t('event.posterAlt', { title: post.title })}
          width={800}
          height={1000}
          loading="eager"
          fetchPriority="high"
          className="aspect-[4/5] w-full rounded-xl border border-line bg-surface-2 object-contain"
          fallback={<EventCover org={coverOrg} large className="aspect-[2/1] w-full rounded-xl lg:aspect-[4/5]" />}
        />
      </div>
    </article>
  )
}
