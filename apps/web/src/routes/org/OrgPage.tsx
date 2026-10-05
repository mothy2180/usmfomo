import { Link, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { ButtonLink, EmptyState, ErrorState, Spinner } from '../../components/ui.tsx'
import { DegradedNotice } from '../../features/public/DegradedNotice.tsx'
import { EventCover } from '../../features/public/EventCover.tsx'
import { useDocumentTitle, useNow } from '../../features/public/hooks.ts'
import { isOrgSlug } from '../../features/public/ids.ts'
import { countOf } from '../../features/public/paging.ts'
import { PostList } from '../../features/public/PostList.tsx'
import { useOrgBySlug, usePostSearch, usePublicReadsEnabled } from '../../features/public/queries.ts'
import { pageUrl } from '../../features/public/share.ts'
import { ShareButton } from '../../features/public/ShareButton.tsx'
import type { OrgSummary } from '../../features/public/types.ts'

/** /o/$slug — one organiser's upcoming events (handy as a bio link). */
export function OrgPage() {
  const { slug } = useParams({ from: '/o/$slug' })
  const { t } = useTranslation('dashboard')
  const query = useOrgBySlug(slug)
  const org = query.data
  const missing = !isOrgSlug(slug) || (query.isSuccess && !org)
  const reads = usePublicReadsEnabled(missing && isOrgSlug(slug))

  useDocumentTitle(missing ? t('org.missingDocTitle') : org ? t('org.docTitle', { name: org.name }) : t('org.loadingDocTitle'))

  return (
    <AppShell wide>
      <p className="m-0 mb-4 text-sm">
        <Link to="/dashboard" className="text-sky underline underline-offset-2">
          <span aria-hidden="true">← </span>
          {t('event.back')}
        </Link>
      </p>
      {missing ? (
        <div className="rounded-xl border border-line bg-surface p-6">
          <h1 className="m-0 text-2xl font-bold">{t('org.missingTitle')}</h1>
          <p className="mb-4 mt-2 text-muted">{t('org.missingBody')}</p>
          <ButtonLink to="/dashboard" variant="primary">
            {t('event.goneCta')}
          </ButtonLink>
          {reads.data === false ? <DegradedNotice /> : null}
        </div>
      ) : query.isError ? (
        <>
          <h1 className="m-0 mb-4 text-2xl font-bold">{t('org.errorTitle')}</h1>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </>
      ) : org ? (
        <OrgEvents org={org} />
      ) : (
        <>
          <h1 className="sr-only">{t('org.loadingDocTitle')}</h1>
          <Spinner />
        </>
      )}
    </AppShell>
  )
}

function OrgEvents({ org }: { org: OrgSummary }) {
  const { t } = useTranslation('dashboard')
  const now = useNow()
  const posts = usePostSearch(org.type, { org: org.id })
  const count = countOf(posts.data)

  return (
    <>
      <header className="flex flex-wrap items-center gap-4">
        <EventCover org={org} className="size-16 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight wrap-anywhere">{org.name}</h1>
          <p className="m-0 mt-1 text-muted">
            {t(`common:orgType.${org.type}One`)} · {t(`common:campus.${org.campus}`)}
          </p>
        </div>
        <ShareButton url={pageUrl(`/o/${org.slug}`)} title={org.name} />
      </header>

      <section aria-labelledby="org-events" className="mt-8">
        <h2 id="org-events" className="m-0 mb-3 text-xl font-bold">
          {t('org.upcoming')}
          {count !== undefined ? (
            <>
              {' '}
              <span className="font-semibold text-muted">({count})</span>
            </>
          ) : null}
        </h2>
        <PostList
          query={posts}
          now={now}
          idPrefix="org"
          layout="grid"
          empty={
            <EmptyState title={t('org.empty', { name: org.name })}>
              <Link to="/dashboard" className="text-sky underline underline-offset-2">
                {t('org.emptyCta')}
              </Link>
            </EmptyState>
          }
        />
      </section>
    </>
  )
}
