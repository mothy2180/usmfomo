import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { OrgCombobox } from './OrgCombobox.tsx'
import type { OrgSummary } from './types.ts'

const orgs: OrgSummary[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Computer Science Society', slug: 'computer-science-society', type: 'club', campus: 'main' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Robotics Club', slug: 'robotics-club', type: 'club', campus: 'engineering' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'School of Computer Sciences', slug: 'school-of-computer-sciences', type: 'school', campus: 'main' },
]

function Harness({ onSelect, type }: { onSelect: (org: OrgSummary | undefined) => void; type?: 'club' | 'school' }) {
  const [selected, setSelected] = useState<string | undefined>()
  return (
    <>
      <label htmlFor="org">Organiser</label>
      <OrgCombobox
        inputId="org"
        orgs={orgs}
        type={type}
        showType={!type}
        selectedId={selected}
        onSelect={(org) => {
          setSelected(org?.id)
          onSelect(org)
        }}
      />
    </>
  )
}

describe('OrgCombobox', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(cleanup)

  it('is a labelled combobox that controls a listbox', () => {
    render(<Harness onSelect={() => {}} />)
    const input = screen.getByRole('combobox', { name: 'Organiser' })
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(input.getAttribute('aria-controls') ?? '')?.getAttribute('role')).toBe('listbox')
  })

  it('filters as you type and picks the highlighted option with Enter', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: 'Organiser' })
    fireEvent.change(input, { target: { value: 'comp' } })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Computer Science SocietyClub', 'School of Computer SciencesSchool'])
    // The best match is highlighted; ArrowDown moves on.
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(orgs[2])
    expect((input as HTMLInputElement).value).toBe('School of Computer Sciences')
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('only suggests organisers of the current tab when given a type', () => {
    render(<Harness onSelect={() => {}} type="club" />)
    const input = screen.getByRole('combobox', { name: 'Organiser' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Computer Science Society', 'Robotics Club'])
  })

  it('selects with a click and clears with the clear button or an empty input', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: 'Organiser' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'robo' } })
    fireEvent.click(screen.getByRole('option', { name: /Robotics Club/ }))
    expect(onSelect).toHaveBeenLastCalledWith(orgs[1])

    fireEvent.click(screen.getByRole('button', { name: 'Clear organiser: Robotics Club' }))
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'robo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith(orgs[1])
    fireEvent.change(input, { target: { value: '' } })
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })

  it('closes with Escape, then clears with a second Escape', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: 'Organiser' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'robo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.value).toBe('Robotics Club')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })

  it('puts the chosen name back when you leave without choosing', () => {
    render(<Harness onSelect={() => {}} />)
    const input = screen.getByRole('combobox', { name: 'Organiser' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'robo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'xyz' } })
    // Shown in the popup and announced through the live region.
    expect(screen.getAllByText('No organisers match.')).toHaveLength(2)
    expect(input.getAttribute('aria-expanded')).toBe('false')
    fireEvent.blur(input)
    expect(input.value).toBe('Robotics Club')
  })
})
