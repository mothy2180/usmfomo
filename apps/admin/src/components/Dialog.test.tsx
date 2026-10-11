import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Dialog } from './Dialog.tsx'

// jsdom has no showModal(). Behave like a browser: close() fires its "close"
// event later, as a task, not synchronously.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
})

afterEach(cleanup)

function OpensOnMount() {
  // Like the moderation and notice dialogs: rendered only when wanted, open from the start.
  const [shown, setShown] = useState(true)
  return shown ? (
    <Dialog open title="Hide post?" onClose={() => setShown(false)}>
      <p>Body</p>
    </Dialog>
  ) : (
    <p>closed</p>
  )
}

describe('Dialog', () => {
  it('stays open when it mounts open under StrictMode', async () => {
    render(
      <StrictMode>
        <OpensOnMount />
      </StrictMode>,
    )
    await act(() => new Promise((r) => setTimeout(r, 10)))
    expect(screen.getByRole('heading', { name: 'Hide post?' })).toBeTruthy()
    expect(screen.queryByText('closed')).toBeNull()
  })

  it('still reports a close the browser makes on its own', async () => {
    render(<OpensOnMount />)
    const dialog = document.querySelector('dialog')!
    await act(async () => {
      dialog.removeAttribute('open')
      dialog.dispatchEvent(new Event('close'))
    })
    expect(screen.getByText('closed')).toBeTruthy()
  })
})
