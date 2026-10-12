import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountCheckError } from '../lib/messages.ts'
import { SessionContext, type Session } from '../lib/sessionContext.ts'
import { AdminApiError } from '../lib/api.ts'
import { StatusErrorPage } from './GatePages.tsx'
import { SignInPage } from './SignInPage.tsx'

vi.mock('../lib/db.ts', () => ({ ownerDb: {}, adminApi: {} }))

vi.mock('../env.ts', () => ({
  PUBLIC_SITE_URL: 'https://usmfomo.pages.dev',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
}))

// The real widget loads Cloudflare's script; this stand-in hands out a token.
vi.mock('../components/Turnstile.tsx', () => ({
  Turnstile: ({ onToken }: { onToken: (token: string | null) => void }) => (
    <button type="button" onClick={() => onToken('turnstile-token')}>
      Pass the security check
    </button>
  ),
}))

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    phase: { kind: 'signed_out', notice: null },
    username: null,
    signIn: vi.fn(async () => {}),
    retryStatus: vi.fn(async () => {}),
    continueLimited: vi.fn(),
    signOut: vi.fn(async () => {}),
    backToSignIn: vi.fn(),
    ...overrides,
  }
}

function renderWith(session: Session, ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionContext value={session}>{ui}</SessionContext>
    </QueryClientProvider>,
  )
}

/** What a screen reader hears when focus arrives: the field's state at that moment. */
function stateOnFocus(el: HTMLElement): Array<{ invalid: string | null; description: string }> {
  const seen: Array<{ invalid: string | null; description: string }> = []
  el.addEventListener('focus', () => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    seen.push({
      invalid: el.getAttribute('aria-invalid'),
      description: ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' '),
    })
  })
  return seen
}

const formOf = (button: HTMLElement) => button.closest('form') as HTMLFormElement

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('SignInPage', () => {
  it('marks an empty field invalid, with its error, before focusing it', () => {
    renderWith(fakeSession(), <SignInPage notice={null} />)
    const username = screen.getByLabelText('Username')
    const seen = stateOnFocus(username)
    fireEvent.submit(formOf(screen.getByRole('button', { name: 'Sign in' })))
    expect(document.activeElement).toBe(username)
    expect(seen).toEqual([{ invalid: 'true', description: 'Enter your username.' }])
    expect(screen.getAllByRole('alert').some((el) => el.textContent === 'Enter your username.')).toBe(true)
  })

  it('shows a failed account check as an alert, and asks for a new security check', async () => {
    const signIn = vi.fn(async () => {
      throw new AccountCheckError()
    })
    renderWith(fakeSession({ signIn }), <SignInPage notice={null} />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pass the security check' }))
    await act(async () => {
      fireEvent.submit(formOf(screen.getByRole('button', { name: 'Sign in' })))
    })
    expect(signIn).toHaveBeenCalledWith('owner', 'a-long-password', 'turnstile-token')
    expect(screen.getAllByRole('alert').some((el) => /Couldn't check this account/.test(el.textContent ?? ''))).toBe(true)
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    // Turnstile tokens are single-use: the next try needs a new one.
    await act(async () => {
      fireEvent.submit(formOf(screen.getByRole('button', { name: 'Sign in' })))
    })
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('keeps focus on the busy Sign in button and ignores more clicks', async () => {
    let finish = () => {}
    const signIn = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    renderWith(fakeSession({ signIn }), <SignInPage notice={null} />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pass the security check' }))
    const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    button.focus()
    await act(async () => {
      fireEvent.click(button)
    })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(signIn).toHaveBeenCalledTimes(1)
    await act(async () => finish())
  })
})

describe('StatusErrorPage (owner-admin unreachable)', () => {
  const down = new AdminApiError('status', 'unavailable', 503)

  it('offers a retry, sign-out and limited mode to an apparent owner', () => {
    const session = fakeSession({ phase: { kind: 'status_error', error: down, ownerHint: true } })
    renderWith(session, <StatusErrorPage error={down} ownerHint />)
    expect(screen.getByRole('alert').textContent).toMatch(/unavailable/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue in limited mode' }))
    expect(session.continueLimited).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(session.retryStatus).toHaveBeenCalledTimes(1)
  })

  it('offers no limited mode without the owner hint', () => {
    renderWith(fakeSession(), <StatusErrorPage error={down} ownerHint={false} />)
    expect(screen.queryByRole('button', { name: 'Continue in limited mode' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })
})
