import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShowOncePassword } from './ShowOncePassword.tsx'

const PASSWORD = 'FakeForTests7vTz3mWx9pLr'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

/** Like the create/reset dialogs: the parent owns the password and drops it on Done. */
function Harness() {
  const [secret, setSecret] = useState<string | null>(PASSWORD)
  return secret ? (
    <ShowOncePassword username="robotics-club" password={secret} lead="Account created." onDone={() => setSecret(null)} />
  ) : (
    <p>Closed</p>
  )
}

describe('ShowOncePassword', () => {
  it('shows the password once, read-only, with a clear warning', () => {
    render(<ShowOncePassword username="robotics-club" password={PASSWORD} lead="Account created." onDone={() => {}} />)
    expect(screen.getByText('Copy this password now. It is shown only once.')).toBeTruthy()
    expect(screen.getByText(/can't be shown again/)).toBeTruthy()
    const field = screen.getByLabelText('Password for robotics-club') as HTMLInputElement
    expect(field.value).toBe(PASSWORD)
    expect(field.readOnly).toBe(true)
    expect(field.getAttribute('autocomplete')).toBe('off')
    expect(screen.getByText('robotics-club')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy password' })).toBeTruthy()
  })

  it('removes the password from the page when Done is pressed', () => {
    const { container } = render(<Harness />)
    expect(container.innerHTML).toContain(PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('Closed')).toBeTruthy()
    expect(container.innerHTML).not.toContain(PASSWORD)
    expect(screen.queryByLabelText('Password for robotics-club')).toBeNull()
  })

  it('copies the password with the Clipboard API and confirms it', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    render(<ShowOncePassword username="robotics-club" password={PASSWORD} onDone={() => {}} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy password' }))
    })
    expect(writeText).toHaveBeenCalledWith(PASSWORD)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.getByText('Copied to the clipboard.')).toBeTruthy()
  })

  it('asks for a manual copy when the clipboard is unavailable', async () => {
    setClipboard(undefined)
    render(<ShowOncePassword username="robotics-club" password={PASSWORD} onDone={() => {}} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy password' }))
    })
    expect(screen.getByText(/Copy failed: select the text/)).toBeTruthy()
  })
})
