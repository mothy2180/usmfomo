import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountCheckError } from '../lib/messages.ts'
import { SessionContext, type Session } from '../lib/sessionContext.ts'
import { ChallengePage } from './ChallengePage.tsx'
import { EnrolFactor } from './EnrolFactor.tsx'
import { EnrolPage } from './EnrolPage.tsx'
import { SecondDevicePage } from './SecondDevicePage.tsx'
import { SignInPage } from './SignInPage.tsx'

const db = vi.hoisted(() => ({ listFactors: vi.fn(), challengeAndVerify: vi.fn(), unenroll: vi.fn() }))

vi.mock('../lib/db.ts', () => ({
  ownerDb: { auth: { mfa: { listFactors: db.listFactors, challengeAndVerify: db.challengeAndVerify, unenroll: db.unenroll } } },
  adminApi: {},
}))

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
    mfaVerified: vi.fn(async () => {}),
    retryStatus: vi.fn(async () => {}),
    continueLimited: vi.fn(async () => {}),
    continueToConsole: vi.fn(async () => {}),
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

function setFactors(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `factor-${i + 1}`,
    friendly_name: i ? 'Backup device' : 'Phone',
    created_at: `2026-10-0${i + 1}T00:00:00Z`,
    factor_type: 'totp',
    status: 'verified',
  }))
  db.listFactors.mockResolvedValue({ data: { totp: rows, all: rows }, error: null })
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

describe('ChallengePage', () => {
  const factors = [{ id: 'factor-1', name: 'Phone', createdAt: '2026-10-01T00:00:00Z' }]

  it('marks a short code invalid, with its error, before focusing the field', () => {
    renderWith(fakeSession({ phase: { kind: 'challenge', factors } }), <ChallengePage factors={factors} />)
    const code = screen.getByLabelText('6-digit code')
    const seen = stateOnFocus(code)
    fireEvent.change(code, { target: { value: '12345' } })
    fireEvent.submit(formOf(screen.getByRole('button', { name: 'Verify' })))
    expect(document.activeElement).toBe(code)
    expect(seen[0]?.invalid).toBe('true')
    expect(seen[0]?.description).toContain('Enter the 6-digit code shown in your authenticator app.')
    expect(db.challengeAndVerify).not.toHaveBeenCalled()
  })

  it('announces a code the server refused and returns focus to the empty field', async () => {
    db.challengeAndVerify.mockResolvedValue({ data: null, error: { code: 'mfa_verification_failed', status: 422 } })
    const session = fakeSession({ phase: { kind: 'challenge', factors } })
    renderWith(session, <ChallengePage factors={factors} />)
    const code = screen.getByLabelText('6-digit code') as HTMLInputElement
    fireEvent.change(code, { target: { value: '123 456' } })
    await act(async () => {
      fireEvent.submit(formOf(screen.getByRole('button', { name: 'Verify' })))
    })
    expect(db.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' })
    expect(screen.getAllByRole('alert').some((el) => /code didn't work/.test(el.textContent ?? ''))).toBe(true)
    expect(code.value).toBe('')
    expect(document.activeElement).toBe(code)
    expect(session.mfaVerified).not.toHaveBeenCalled()
  })
})

describe('EnrolFactor', () => {
  it('focuses the device name with its error already attached', () => {
    renderWith(fakeSession(), <EnrolFactor defaultName="" existingNames={[]} onVerified={() => {}} />)
    const name = screen.getByLabelText('Device name')
    const seen = stateOnFocus(name)
    fireEvent.submit(formOf(screen.getByRole('button', { name: 'Show the QR code' })))
    expect(document.activeElement).toBe(name)
    expect(seen[0]?.invalid).toBe('true')
    expect(seen[0]?.description).toContain('Give the device a name')
    // Announced even when focus was already in the field.
    const error = screen.getAllByRole('alert').find((el) => /Give the device a name/.test(el.textContent ?? ''))
    expect(error).toBeTruthy()
  })
})

describe('SecondDevicePage (two devices required)', () => {
  it('asks for a second device with no way to skip it', async () => {
    setFactors(1)
    const session = fakeSession({ phase: { kind: 'second_device' } })
    renderWith(session, <SecondDevicePage />)
    expect(await screen.findByText('Phone')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Add a second device' })).toBeTruthy()
    expect(screen.getByText(/any TOTP app: a second phone, a tablet, or a password manager/)).toBeTruthy()
    expect(screen.getByLabelText('Device name')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(session.signOut).toHaveBeenCalledTimes(1)
    expect(session.continueToConsole).not.toHaveBeenCalled()
  })

  it('offers the console once two devices are enrolled', async () => {
    setFactors(2)
    const session = fakeSession({ phase: { kind: 'second_device' } })
    renderWith(session, <SecondDevicePage />)
    const heading = await screen.findByRole('heading', { name: 'Two devices enrolled' })
    // The new step's heading takes focus, so the change is read out.
    expect(document.activeElement).toBe(heading)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue to the console' }))
    })
    expect(session.continueToConsole).toHaveBeenCalledTimes(1)
  })

  it('offers a retry, but no way in, when the devices cannot be listed', async () => {
    db.listFactors.mockResolvedValue({ data: null, error: { message: 'Auth unavailable', status: 503 } })
    renderWith(fakeSession({ phase: { kind: 'second_device' } }), <SecondDevicePage />)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })
})

describe('EnrolPage', () => {
  it('says up front that two devices are required, and which kinds work', () => {
    renderWith(fakeSession({ phase: { kind: 'enrol' } }), <EnrolPage />)
    expect(screen.getByText('Two devices are required')).toBeTruthy()
    expect(screen.getByText(/a second phone, a tablet or a password manager/)).toBeTruthy()
  })
})
