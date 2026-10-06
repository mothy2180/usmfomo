import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field, Input, Select, Textarea } from './ui.tsx'

function NameField({ error, hint }: { error?: string | null; hint?: string }) {
  return (
    <Field label="Event name" hint={hint} error={error}>
      {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} />}
    </Field>
  )
}

describe('Field', () => {
  afterEach(cleanup)

  it('keeps its error live region on the page, so a later error is announced', () => {
    const view = render(<NameField hint="As students will see it." />)
    const input = screen.getByLabelText('Event name')
    const region = view.container.querySelector('[aria-live="polite"]')!
    // Present and exposed (not display:none) before any error; not described by it yet.
    expect(region.id).not.toBe('')
    expect(region.textContent).toBe('')
    expect(region.classList.contains('hidden')).toBe(false)
    expect(input.getAttribute('aria-describedby')?.split(' ')).not.toContain(region.id)

    view.rerender(<NameField hint="As students will see it." error="Required." />)
    // The same element (same id) now holds the error, and the field points to it.
    expect(view.container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region.textContent).toBe('Required.')
    expect(region.classList.contains('sr-only')).toBe(false)
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toContain(region.id)
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual(['As students will see it.', 'Required.'])

    view.rerender(<NameField hint="As students will see it." />)
    expect(view.container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region.textContent).toBe('')
  })
})

describe('form controls', () => {
  afterEach(cleanup)

  it('draw their edge in the field-line colour, not the faint divider colour', () => {
    render(
      <>
        <Input aria-label="Venue" />
        <Select aria-label="Campus">
          <option>Main campus</option>
        </Select>
        <Textarea aria-label="About" />
      </>,
    )
    for (const el of [screen.getByLabelText('Venue'), screen.getByLabelText('Campus'), screen.getByLabelText('About')]) {
      expect(el.classList.contains('border-field-line')).toBe(true)
      expect(el.classList.contains('border-line')).toBe(false)
    }
  })
})
