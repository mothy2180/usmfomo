import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import type { ProcessedPoster } from '../../lib/poster.ts'
import { PosterPicker, type PosterSelection } from './PosterPicker.tsx'

const processed: ProcessedPoster = {
  poster: new Blob(['p'], { type: 'image/webp' }),
  thumb: new Blob(['t'], { type: 'image/webp' }),
  format: { type: 'image/webp', ext: 'webp' },
  size: { width: 1200, height: 1600 },
  thumbSize: { width: 300, height: 400 },
}

/** PostForm's selection rules: removing goes back to the current poster's
 * "removed" state on edit, or to nothing on create. */
function Harness({ initial, hadPoster }: { initial: PosterSelection; hadPoster: boolean }) {
  const [selection, setSelection] = useState<PosterSelection>(initial)
  return (
    <PosterPicker
      selection={selection}
      busy={false}
      error={null}
      existingUrl={hadPoster ? '/i/poster.webp' : undefined}
      onPick={() => {}}
      onRemove={() => setSelection(hadPoster ? { kind: 'removed' } : { kind: 'none' })}
      onUndoRemove={() => setSelection({ kind: 'existing' })}
    />
  )
}

const fileInput = () => screen.getByLabelText('Poster (optional)') as HTMLInputElement
const image = new File(['x'], 'poster.png', { type: 'image/png' })

describe('PosterPicker', () => {
  beforeAll(async () => {
    URL.createObjectURL = vi.fn(() => 'blob:poster')
    URL.revokeObjectURL = vi.fn()
    await i18n.changeLanguage('en')
  })
  afterEach(cleanup)

  it('keeps focus on the file input while a poster is processed, and ignores picks then', () => {
    const onPick = vi.fn()
    const props = { selection: { kind: 'none' } as const, error: null, onPick, onRemove: () => {}, onUndoRemove: () => {} }
    const { rerender } = render(<PosterPicker {...props} busy={false} />)
    fileInput().focus()
    rerender(<PosterPicker {...props} busy />)
    const input = fileInput()
    // Not `disabled`: that would drop focus to <body>.
    expect(input.disabled).toBe(false)
    expect(input.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(input)
    // The file chooser does not open, and a change is ignored.
    expect(fireEvent.click(input)).toBe(false)
    fireEvent.change(input, { target: { files: [image] } })
    expect(onPick).not.toHaveBeenCalled()

    rerender(<PosterPicker {...props} busy={false} />)
    expect(fileInput().getAttribute('aria-disabled')).toBeNull()
    expect(fireEvent.click(fileInput())).toBe(true)
    fireEvent.change(fileInput(), { target: { files: [image] } })
    expect(onPick).toHaveBeenCalledWith(image)
  })

  it('is really disabled while posting is paused', () => {
    render(<PosterPicker selection={{ kind: 'none' }} busy={false} error={null} disabled onPick={() => {}} onRemove={() => {}} onUndoRemove={() => {}} />)
    expect(fileInput().disabled).toBe(true)
  })

  it('moves focus between "Remove poster" and "Keep the current poster" instead of losing it', () => {
    render(<Harness initial={{ kind: 'existing' }} hadPoster />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove poster' }))
    expect(screen.getByText('The poster will be removed when you save.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep the current poster' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep the current poster' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove poster' }))
  })

  it('focuses the file input after removing a new poster that has nothing to go back to', () => {
    render(<Harness initial={{ kind: 'new', processed }} hadPoster={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove poster' }))
    expect(screen.queryByRole('button', { name: 'Remove poster' })).toBeNull()
    expect(document.activeElement).toBe(fileInput())
  })
})
