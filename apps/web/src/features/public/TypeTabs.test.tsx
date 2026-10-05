import type { OrgType } from '@usmfomo/shared/config'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { panelId } from './domIds.ts'
import { TypeTabs } from './TypeTabs.tsx'

function Harness({ onSelect }: { onSelect: (type: OrgType) => void }) {
  const [active, setActive] = useState<OrgType>('club')
  return (
    <TypeTabs
      idPrefix="t"
      active={active}
      counts={{ club: 3, school: 0 }}
      onSelect={(type) => {
        setActive(type)
        onSelect(type)
      }}
    />
  )
}

describe('TypeTabs', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(cleanup)

  it('is a labelled tablist with one tab stop and counts in the names', () => {
    render(<Harness onSelect={() => {}} />)
    expect(screen.getByRole('tablist', { name: 'Event organisers' })).toBeTruthy()
    const clubs = screen.getByRole('tab', { name: 'Clubs (3)' })
    const schools = screen.getByRole('tab', { name: 'Schools (0)' })
    expect(clubs.getAttribute('aria-selected')).toBe('true')
    expect(clubs.tabIndex).toBe(0)
    expect(schools.tabIndex).toBe(-1)
    expect(clubs.getAttribute('aria-controls')).toBe(panelId('t', 'club'))
  })

  it('moves with the arrow keys, Home and End, and follows focus', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const clubs = screen.getByRole('tab', { name: /Clubs/ })
    const schools = screen.getByRole('tab', { name: /Schools/ })
    clubs.focus()

    fireEvent.keyDown(clubs, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('school')
    expect(document.activeElement).toBe(schools)
    expect(schools.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(schools, { key: 'ArrowRight' }) // wraps around
    expect(onSelect).toHaveBeenLastCalledWith('club')
    expect(document.activeElement).toBe(clubs)

    fireEvent.keyDown(clubs, { key: 'End' })
    expect(document.activeElement).toBe(schools)
    fireEvent.keyDown(schools, { key: 'Home' })
    expect(document.activeElement).toBe(clubs)
    fireEvent.keyDown(clubs, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(schools)

    onSelect.mockClear()
    fireEvent.keyDown(schools, { key: 'a' })
    expect(onSelect).not.toHaveBeenCalled()
  })
})
