import { CAMPUSES, type Campus, type OrgType } from '@usmfomo/shared/config'
import { readItem, safeLocalStorage, writeItem } from './storage.ts'

// Per-device conveniences for the dashboard (never needed for correctness).
const TAB_KEY = 'usmfomo.dashboard.tab'
const CAMPUS_KEY = 'usmfomo.dashboard.campus'

export type DashboardPrefs = { tab?: OrgType; campus?: Campus }

export function readPrefs(storage: Storage | null = safeLocalStorage()): DashboardPrefs {
  const tab = readItem(TAB_KEY, storage)
  const campus = readItem(CAMPUS_KEY, storage)
  return {
    ...(tab === 'club' || tab === 'school' ? { tab } : {}),
    ...(campus && (CAMPUSES as readonly string[]).includes(campus) ? { campus: campus as Campus } : {}),
  }
}

export function writeTabPref(tab: OrgType, storage: Storage | null = safeLocalStorage()): void {
  writeItem(TAB_KEY, tab, storage)
}

/** undefined = "All campuses" (forget the choice). */
export function writeCampusPref(campus: Campus | undefined, storage: Storage | null = safeLocalStorage()): void {
  writeItem(CAMPUS_KEY, campus ?? null, storage)
}
