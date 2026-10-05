import type { OrgType } from '@usmfomo/shared/config'
import type { DashboardSearch } from '../../router.tsx'
import type { DashboardPrefs } from './prefs.ts'

/** A change to the dashboard search params; a key set to undefined (or '')
 * removes that param. */
export type SearchPatch = { [K in keyof DashboardSearch]?: DashboardSearch[K] | undefined }

export const DEFAULT_TAB: OrgType = 'club'
const Q_MAX = 100

export function activeTab(search: DashboardSearch): OrgType {
  return search.tab ?? DEFAULT_TAB
}

/**
 * Applies a patch to the current search params and returns clean params
 * (no empty values, q trimmed to 100 characters like the database does).
 * Switching tab drops the organiser filter — organisers belong to one tab —
 * unless the same patch sets `org`.
 */
export function withSearch(prev: DashboardSearch, patch: SearchPatch): DashboardSearch {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(prev)) {
    if (typeof value === 'string' && value !== '') next[key] = value
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') delete next[key]
    else next[key] = value
  }
  if (next.q !== undefined) {
    const q = next.q.trim().slice(0, Q_MAX).trim()
    if (q) next.q = q
    else delete next.q
  }
  if (patch.tab !== undefined && patch.tab !== activeTab(prev) && !('org' in patch)) delete next.org
  return next as DashboardSearch
}

export function hasActiveFilters(search: DashboardSearch): boolean {
  return Boolean(search.q || search.campus || search.org)
}

/** "Clear filters": keep the tab, drop everything else. */
export function clearFilters(search: DashboardSearch): DashboardSearch {
  return search.tab ? { tab: search.tab } : {}
}

/**
 * On a fresh visit, bring back the remembered tab and campus. The URL always
 * wins; the campus is only restored on a plain visit (no q/org), so a shared
 * search link is never narrowed by the viewer's own campus.
 */
export function restorePrefs(search: DashboardSearch, prefs: DashboardPrefs): SearchPatch | null {
  const patch: SearchPatch = {}
  if (!search.tab && prefs.tab && prefs.tab !== DEFAULT_TAB) patch.tab = prefs.tab
  if (!search.campus && !search.q && !search.org && prefs.campus) patch.campus = prefs.campus
  return Object.keys(patch).length > 0 ? patch : null
}
