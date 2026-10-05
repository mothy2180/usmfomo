import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import type { DashboardSearch } from '../../router.tsx'
import { FiltersBar, SEARCH_DEBOUNCE_MS } from './FiltersBar.tsx'
import { clearFilters, withSearch } from './search.ts'

/** FiltersBar wired to local state the way DashboardPage wires it to the URL. */
function Harness({ initial = {}, onQuery }: { initial?: DashboardSearch; onQuery: (q: string | undefined) => void }) {
  const [search, setSearch] = useState<DashboardSearch>(initial)
  return (
    <>
      <FiltersBar
        search={search}
        onQuery={(q) => {
          onQuery(q)
          setSearch((prev) => withSearch(prev, { q }))
        }}
        onCampus={(campus) => setSearch((prev) => withSearch(prev, { campus }))}
        onOrg={(org) => setSearch((prev) => withSearch(prev, { org: org?.id }))}
        onClear={() => setSearch((prev) => clearFilters(prev))}
        orgs={[]}
        orgsLoading={false}
      />
      <output data-testid="search">{JSON.stringify(search)}</output>
    </>
  )
}

const state = () => JSON.parse(screen.getByTestId('search').textContent ?? '{}') as DashboardSearch

describe('FiltersBar', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('debounces typing into one search', () => {
    const onQuery = vi.fn()
    render(<Harness onQuery={onQuery} />)
    const input = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'ro' } })
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50))
    fireEvent.change(input, { target: { value: 'robot ' } })
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50))
    expect(onQuery).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(50))
    expect(onQuery).toHaveBeenCalledTimes(1)
    expect(onQuery).toHaveBeenCalledWith('robot')
    expect(state()).toEqual({ q: 'robot' })
    // Typing kept going while the URL updated: nothing typed is lost.
    expect((input as HTMLInputElement).value).toBe('robot ')
  })

  it('searches at once on Enter', () => {
    const onQuery = vi.fn()
    render(<Harness onQuery={onQuery} />)
    const input = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'hack' } })
    fireEvent.submit(input.closest('form')!)
    expect(onQuery).toHaveBeenCalledWith('hack')
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2))
    expect(onQuery).toHaveBeenCalledTimes(1)
  })

  it('sets the campus and clears every filter, keeping the tab', () => {
    render(<Harness onQuery={() => {}} initial={{ tab: 'school', q: 'talk' }} />)
    const input = screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement
    expect(input.value).toBe('talk')
    fireEvent.change(screen.getByRole('combobox', { name: 'Campus' }), { target: { value: 'health' } })
    expect(state()).toEqual({ tab: 'school', q: 'talk', campus: 'health' })

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(state()).toEqual({ tab: 'school' })
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('lists every campus with an "All campuses" choice', () => {
    render(<Harness onQuery={() => {}} />)
    const options = [...(screen.getByRole('combobox', { name: 'Campus' }) as HTMLSelectElement).options].map((o) => o.value)
    expect(options).toEqual(['', 'main', 'engineering', 'health', 'other', 'online'])
  })
})
