import { useNavigate, useSearch } from '@tanstack/react-router'
import { ORG_TYPES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { DegradedNotice } from '../../features/public/DegradedNotice.tsx'
import { FiltersBar } from '../../features/public/FiltersBar.tsx'
import { useDocumentTitle, useMediaQuery, useNow, WIDE_QUERY } from '../../features/public/hooks.ts'
import { NoticeStrip } from '../../features/public/NoticeStrip.tsx'
import { countOf } from '../../features/public/paging.ts'
import { PostPanel } from '../../features/public/PostPanel.tsx'
import { readPrefs, writeCampusPref, writeTabPref } from '../../features/public/prefs.ts'
import { useNotices, useOrgs, usePostSearch, usePublicReadsEnabled } from '../../features/public/queries.ts'
import { activeTab, clearFilters, hasActiveFilters, restorePrefs, withSearch, type SearchPatch } from '../../features/public/search.ts'
import { TypeTabs } from '../../features/public/TypeTabs.tsx'
import type { OrgSummary, PostFilters } from '../../features/public/types.ts'

const ID = 'dash'
const TITLE_ID = 'page-title'
const NO_ORGS: readonly OrgSummary[] = []

/** /dashboard — what's on, no login. Clubs | Schools as tabs on phones and
 * side by side from the lg breakpoint; filters live in the URL. */
export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const search = useSearch({ from: '/dashboard' })
  const navigate = useNavigate({ from: '/dashboard' })
  const wide = useMediaQuery(WIDE_QUERY)
  const now = useNow()
  useDocumentTitle(t('dashboard.docTitle'))

  const update = useCallback(
    (patch: SearchPatch) => {
      void navigate({ search: (prev) => withSearch(prev, patch), replace: true })
    },
    [navigate],
  )

  // The remembered tab and campus come back once, on arrival, through the URL.
  // The lists wait for that navigation, so their first requests already carry
  // the restored campus instead of fetching everything once for nothing.
  const [pendingPrefs, setPendingPrefs] = useState(() => restorePrefs(search, readPrefs()))
  useEffect(() => {
    if (!pendingPrefs) return
    void navigate({ search: (prev) => withSearch(prev, pendingPrefs), replace: true }).finally(() => setPendingPrefs(null))
  }, [pendingPrefs, navigate])

  const tab = activeTab(search)
  const filtersActive = hasActiveFilters(search)

  // The organiser list is fetched only once someone focuses the organiser
  // field, or arrives with one in the URL: most visits never need it.
  const [orgsWanted, setOrgsWanted] = useState(false)
  const orgsQuery = useOrgs(orgsWanted || Boolean(search.org))
  const orgs = orgsQuery.data ?? NO_ORGS
  const selectedOrg = search.org ? orgs.find((o) => o.id === search.org) : undefined
  // The panel the organiser filter applies to: the organiser's type once the
  // list is here, the current tab until then; undefined = unknown organiser.
  const orgPanel: OrgType | undefined = !search.org ? undefined : (selectedOrg?.type ?? (orgsQuery.isPending ? tab : undefined))
  const orgIsElsewhere = (type: OrgType) => Boolean(search.org && orgPanel && orgPanel !== type)

  // Keep the tab in line with the chosen organiser (e.g. a hand-edited link).
  useEffect(() => {
    if (selectedOrg && selectedOrg.type !== tab) update({ tab: selectedOrg.type, org: selectedOrg.id })
  }, [selectedOrg, tab, update])

  const filtersFor = (type: OrgType): PostFilters => ({
    q: search.q,
    campus: search.campus,
    org: search.org && !orgIsElsewhere(type) ? search.org : undefined,
  })
  const listEnabled = (type: OrgType) => !pendingPrefs && !orgIsElsewhere(type)
  const club = usePostSearch('club', filtersFor('club'), { enabled: listEnabled('club'), keepPrevious: true })
  const school = usePostSearch('school', filtersFor('school'), { enabled: listEnabled('school'), keepPrevious: true })
  const queries = { club, school }
  const counts = {
    club: orgIsElsewhere('club') ? undefined : countOf(club.data),
    school: orgIsElsewhere('school') ? undefined : countOf(school.data),
  }

  // Everything empty without filters: check whether public reads are off.
  const allEmpty = !filtersActive && counts.club === 0 && counts.school === 0
  const reads = usePublicReadsEnabled(allEmpty)
  const degraded = allEmpty && reads.data === false

  const notices = useNotices()

  const onQuery = useCallback((q: string | undefined) => update({ q }), [update])
  const wantOrgs = useCallback(() => setOrgsWanted(true), [])
  const onCampus = (campus: Campus | undefined) => {
    writeCampusPref(campus)
    update({ campus })
  }
  const onOrg = (org: OrgSummary | undefined) => update(org ? { org: org.id, tab: org.type } : { org: undefined })
  const onClear = () => {
    writeCampusPref(undefined)
    void navigate({ search: (prev) => clearFilters(prev), replace: true })
  }
  const selectTab = (next: OrgType) => {
    writeTabPref(next)
    update({ tab: next })
  }

  // Result counts for screen readers after a filter change.
  const settled = ORG_TYPES.filter((type) => counts[type] !== undefined && !queries[type].isPlaceholderData)
  const summary = filtersActive
    ? settled.map((type) => t(type === 'club' ? 'dashboard.countClub' : 'dashboard.countSchool', { count: counts[type] })).join(', ')
    : ''

  return (
    <AppShell wide>
      <h1 id={TITLE_ID} tabIndex={-1} className="m-0 text-3xl font-extrabold tracking-tight">
        {t('dashboard.title')}
      </h1>
      <p className="m-0 mt-1 text-muted">{t('dashboard.intro')}</p>

      {notices.data ? (
        <NoticeStrip notices={notices.data} now={now} onAllDismissed={() => document.getElementById(TITLE_ID)?.focus()} />
      ) : null}

      <FiltersBar
        search={search}
        onQuery={onQuery}
        onCampus={onCampus}
        onOrg={onOrg}
        onClear={onClear}
        orgs={orgs}
        orgsLoading={orgsQuery.isLoading}
        onOrgsWanted={wantOrgs}
        orgType={wide ? undefined : tab}
      />
      <p className="sr-only" aria-live="polite">
        {summary}
      </p>

      {degraded ? (
        <DegradedNotice />
      ) : (
        <>
          {wide ? null : <TypeTabs idPrefix={ID} active={tab} onSelect={selectTab} counts={counts} />}
          <div className={wide ? 'mt-8 grid grid-cols-2 gap-8' : 'mt-4'}>
            {ORG_TYPES.map((type) => (
              <PostPanel
                key={type}
                type={type}
                idPrefix={ID}
                asTabPanel={!wide}
                hidden={!wide && tab !== type}
                query={queries[type]}
                now={now}
                q={search.q}
                filtersActive={filtersActive}
                onClearFilters={onClear}
                otherOrg={orgIsElsewhere(type) ? { name: selectedOrg?.name, onClear: () => update({ org: undefined }) } : undefined}
              />
            ))}
          </div>
        </>
      )}
    </AppShell>
  )
}
