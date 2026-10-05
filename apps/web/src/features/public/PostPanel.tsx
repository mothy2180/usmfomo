import { Link } from '@tanstack/react-router'
import type { OrgType } from '@usmfomo/shared/config'
import { Trans, useTranslation } from 'react-i18next'
import { Button, EmptyState } from '../../components/ui.tsx'
import { cx } from '../../lib/cx.ts'
import { panelId, tabId } from './domIds.ts'
import { countOf } from './paging.ts'
import { PostList } from './PostList.tsx'
import type { usePostSearch } from './queries.ts'

type Props = {
  type: OrgType
  idPrefix: string
  /** Mobile: a tabpanel labelled by its tab. Desktop: a plain region. */
  asTabPanel: boolean
  hidden: boolean
  query: ReturnType<typeof usePostSearch>
  now: Date
  q?: string
  filtersActive: boolean
  onClearFilters: () => void
  /** The organiser filter belongs to the other type: say so instead of a list. */
  otherOrg?: { name?: string; onClear: () => void }
}

export function PostPanel({ type, idPrefix, asTabPanel, hidden, query, now, q, filtersActive, onClearFilters, otherOrg }: Props) {
  const { t } = useTranslation('dashboard')
  const headingId = `${idPrefix}-heading-${type}`
  const count = otherOrg ? undefined : countOf(query.data)

  const empty = filtersActive ? (
    <EmptyState title={q ? t('panel.noResultsQuery', { q }) : t('panel.noResultsFilters')}>
      <Button onClick={onClearFilters} className="mt-1">
        {t('filters.clear')}
      </Button>
    </EmptyState>
  ) : (
    <EmptyState title={t(`panel.empty.${type}`)}>
      <Trans
        t={t}
        i18nKey="panel.emptyHint"
        components={{ rules: <Link to="/rules" className="text-sky underline underline-offset-2" /> }}
      />
    </EmptyState>
  )

  return (
    <section
      id={panelId(idPrefix, type)}
      role={asTabPanel ? 'tabpanel' : undefined}
      aria-labelledby={asTabPanel ? tabId(idPrefix, type) : headingId}
      hidden={hidden}
      tabIndex={asTabPanel ? 0 : undefined}
      className="min-w-0 rounded-xl"
    >
      <h2 id={headingId} className={cx('m-0 mb-3 text-xl font-bold', asTabPanel && 'sr-only')}>
        {t(`common:orgType.${type}`)}
        {count !== undefined ? (
          <>
            {' '}
            <span className="font-semibold text-muted">({count})</span>
          </>
        ) : null}
      </h2>
      {otherOrg ? (
        <EmptyState title={otherOrg.name ? t('panel.otherOrg', { name: otherOrg.name }) : t('panel.otherOrgUnnamed')}>
          <Button onClick={otherOrg.onClear} className="mt-1">
            {t('panel.clearOrg')}
          </Button>
        </EmptyState>
      ) : (
        <PostList query={query} now={now} idPrefix={`${idPrefix}-${type}`} empty={empty} />
      )}
    </section>
  )
}
