import { beforeEach, describe, expect, it } from 'vitest'
import { readPrefs, writeCampusPref, writeTabPref } from './prefs.ts'
import { activeTab, clearFilters, hasActiveFilters, restorePrefs, withSearch } from './search.ts'

const ORG = '22222222-2222-4222-8222-222222222222'

describe('withSearch', () => {
  it('sets and removes params, dropping empty values', () => {
    expect(withSearch({}, { q: 'hack' })).toEqual({ q: 'hack' })
    expect(withSearch({ q: 'hack', campus: 'main' }, { q: undefined })).toEqual({ campus: 'main' })
    expect(withSearch({ q: 'hack' }, { q: '' })).toEqual({})
    expect(withSearch({ campus: 'main' }, { campus: 'health' })).toEqual({ campus: 'health' })
  })

  it('trims q and caps it at 100 characters like search_posts', () => {
    expect(withSearch({}, { q: '  robot  ' })).toEqual({ q: 'robot' })
    expect(withSearch({}, { q: '   ' })).toEqual({})
    expect(withSearch({}, { q: 'x'.repeat(150) }).q).toHaveLength(100)
  })

  it('drops the organiser when the tab changes', () => {
    expect(withSearch({ org: ORG, q: 'a' }, { tab: 'school' })).toEqual({ tab: 'school', q: 'a' })
    expect(withSearch({ tab: 'school', org: ORG }, { tab: 'club' })).toEqual({ tab: 'club' })
  })

  it('keeps the organiser when the tab stays the same or the patch sets it', () => {
    // No tab param means the default (Clubs) tab.
    expect(withSearch({ org: ORG }, { tab: 'club' })).toEqual({ org: ORG, tab: 'club' })
    expect(withSearch({ tab: 'club' }, { tab: 'school', org: ORG })).toEqual({ tab: 'school', org: ORG })
    expect(withSearch({ tab: 'school', org: ORG }, { org: undefined })).toEqual({ tab: 'school' })
  })

  it('does not mutate the previous params', () => {
    const prev = { q: 'a', org: ORG }
    withSearch(prev, { tab: 'school', q: undefined })
    expect(prev).toEqual({ q: 'a', org: ORG })
  })
})

describe('filters', () => {
  it('knows when filters are active', () => {
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters({ tab: 'school' })).toBe(false)
    expect(hasActiveFilters({ q: 'x' })).toBe(true)
    expect(hasActiveFilters({ campus: 'health' })).toBe(true)
    expect(hasActiveFilters({ org: ORG })).toBe(true)
  })

  it('Clear filters keeps only the tab', () => {
    expect(clearFilters({ tab: 'school', q: 'x', campus: 'main', org: ORG })).toEqual({ tab: 'school' })
    expect(clearFilters({ q: 'x' })).toEqual({})
  })

  it('defaults to the Clubs tab', () => {
    expect(activeTab({})).toBe('club')
    expect(activeTab({ tab: 'school' })).toBe('school')
  })
})

describe('remembered tab and campus', () => {
  beforeEach(() => window.localStorage.clear())

  it('reads back what was stored and ignores junk', () => {
    expect(readPrefs()).toEqual({})
    writeTabPref('school')
    writeCampusPref('health')
    expect(readPrefs()).toEqual({ tab: 'school', campus: 'health' })
    writeCampusPref(undefined)
    expect(readPrefs()).toEqual({ tab: 'school' })
    window.localStorage.setItem('usmfomo.dashboard.tab', 'admin')
    window.localStorage.setItem('usmfomo.dashboard.campus', 'moon')
    expect(readPrefs()).toEqual({})
  })

  it('restores the remembered tab and campus on a plain visit', () => {
    expect(restorePrefs({}, { tab: 'school', campus: 'health' })).toEqual({ tab: 'school', campus: 'health' })
    expect(restorePrefs({}, {})).toBeNull()
    // The default tab needs no param.
    expect(restorePrefs({}, { tab: 'club' })).toBeNull()
  })

  it('lets the URL win', () => {
    expect(restorePrefs({ tab: 'club', campus: 'main' }, { tab: 'school', campus: 'health' })).toBeNull()
  })

  it('never narrows a shared search link with the remembered campus', () => {
    expect(restorePrefs({ q: 'hack' }, { campus: 'health' })).toBeNull()
    expect(restorePrefs({ org: ORG }, { campus: 'health' })).toBeNull()
    expect(restorePrefs({ q: 'hack' }, { tab: 'school', campus: 'health' })).toEqual({ tab: 'school' })
  })
})
