import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Dialog } from './Dialog.tsx'

afterEach(cleanup)

const dialogEl = () => document.querySelector('dialog') as HTMLDialogElement

/** What the browser does on Escape: a cancelable "cancel" event on the dialog. */
const pressEscape = () => dialogEl().dispatchEvent(new Event('cancel', { cancelable: true }))

describe('ConfirmDialog', () => {
  it('explains the effect and confirms on request', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog open title="Pause robotics-club?" confirmLabel="Pause account" onConfirm={onConfirm} onClose={() => {}}>
        <p>They can’t sign in.</p>
      </ConfirmDialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Pause robotics-club?' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('They can’t sign in.')
    fireEvent.click(screen.getByRole('button', { name: 'Pause account' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('only enables a destructive confirm after the exact text is typed', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog open title="Delete?" confirmLabel="Delete account" confirmText="robotics-club" onConfirm={onConfirm} onClose={() => {}}>
        <p>Gone for good.</p>
      </ConfirmDialog>,
    )
    const confirm = screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement
    const input = screen.getByLabelText('Type robotics-club to confirm')
    expect(confirm.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'robotics' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.submit(confirm.form!)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'robotics-club' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, but not while busy', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ConfirmDialog open title="Hide?" confirmLabel="Hide post" busy onConfirm={() => {}} onClose={onClose}>
        <p>Hidden at once.</p>
      </ConfirmDialog>,
    )
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(
      <ConfirmDialog open title="Hide?" confirmLabel="Hide post" onConfirm={() => {}} onClose={onClose}>
        <p>Hidden at once.</p>
      </ConfirmDialog>,
    )
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the error from a failed attempt', () => {
    render(
      <ConfirmDialog open title="Hide?" confirmLabel="Hide post" error="Not allowed." onConfirm={() => {}} onClose={() => {}}>
        <p>x</p>
      </ConfirmDialog>,
    )
    expect(screen.getByRole('alert').textContent).toBe('Not allowed.')
  })
})

describe('Dialog', () => {
  it('focuses the [data-autofocus] element when it opens', () => {
    render(
      <Dialog open title="Still there?" onClose={() => {}}>
        <button type="button">Sign out now</button>
        <button type="button" data-autofocus>
          Stay signed in
        </button>
      </Dialog>,
    )
    expect(document.activeElement?.textContent).toBe('Stay signed in')
  })

  it('reopens itself when the browser forces it closed while locked', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open title="New password" onClose={onClose} preventEscape>
        <p>secret</p>
      </Dialog>,
    )
    const el = dialogEl()
    el.removeAttribute('open')
    el.dispatchEvent(new Event('close'))
    expect(el.hasAttribute('open')).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    rerender(
      <Dialog open title="New password" onClose={onClose}>
        <p>secret</p>
      </Dialog>,
    )
    el.removeAttribute('open')
    el.dispatchEvent(new Event('close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the title when the step changes, and back to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { rerender } = render(
      <Dialog open title="Manage" onClose={() => {}} focusKey="menu">
        <button type="button">Reset password</button>
      </Dialog>,
    )
    rerender(
      <Dialog open title="Reset the password?" onClose={() => {}} focusKey="confirm">
        <button type="button">Back</button>
      </Dialog>,
    )
    expect(document.activeElement?.textContent).toBe('Reset the password?')
    rerender(
      <Dialog open={false} title="Reset the password?" onClose={() => {}} focusKey="confirm">
        <button type="button">Back</button>
      </Dialog>,
    )
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
