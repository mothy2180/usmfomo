import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeStudioDb } from '../../features/studio/fakeStudioDb.ts'
import { renderRoute } from '../../features/studio/renderRoute.tsx'
import i18n from '../../lib/i18n.ts'
import { LoginPage } from './LoginPage.tsx'

const mock = vi.hoisted(() => ({
  fake: null as FakeStudioDb | null,
  captcha: { token: 'tok-1' as string | null, status: 'solved' as 'loading' | 'ready' | 'solved' | 'error', reset: (() => {}) as () => void },
}))

vi.mock('../../lib/db.ts', async () => {
  const { createFakeStudioDb } = await import('../../features/studio/fakeStudioDb.ts')
  mock.fake = createFakeStudioDb()
  return { studioDb: mock.fake.db, imageSrc: () => undefined, onImageError: () => {} }
})
vi.mock('../../env.ts', () => ({ CONTACT_URL: 'https://instagram.com/usmfomo', TURNSTILE_SITE_KEY: 'test' }))
vi.mock('../../lib/turnstile.ts', () => ({
  useTurnstile: () => ({ attach: () => {}, retry: () => {}, ...mock.captcha }),
}))

const fake = () => mock.fake!

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

describe('LoginPage', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mock.captcha.token = 'tok-1'
    mock.captcha.status = 'solved'
    mock.captcha.reset = vi.fn()
    fake().setSession(null, 'INITIAL_SESSION')
    fake().db.rpc.mockResolvedValue({ data: { state: 'ok', username: 'robotik' }, error: null })
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal1', 'aal1'))
  })
  afterEach(cleanup)

  it('shows the admins-only note with the contact link', async () => {
    renderRoute('/login', '/login', LoginPage)
    expect(await screen.findByRole('heading', { name: 'Club & school sign in' })).toBeTruthy()
    expect(screen.getByText(/For club & school admins only/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Message the usmfomo admin' })
    expect(link.getAttribute('href')).toBe('https://instagram.com/usmfomo')
    expect(screen.getByLabelText('Username').getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
  })

  it('checks the fields before calling Auth and focuses the first problem', async () => {
    renderRoute('/login', '/login', LoginPage)
    await screen.findByLabelText('Username')
    submit()
    expect(await screen.findByText('Enter your username.')).toBeTruthy()
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(screen.getByLabelText('Username').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Username'))
    fill('Not Valid!', 'x')
    submit()
    expect(await screen.findByText('3–32 lowercase letters, numbers or dashes.')).toBeTruthy()
    expect(fake().db.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('asks for the security check before signing in', async () => {
    mock.captcha.token = null
    mock.captcha.status = 'ready'
    renderRoute('/login', '/login', LoginPage)
    await screen.findByLabelText('Username')
    fill('robotik', 'correct horse')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Complete the security check first.')
    expect(fake().db.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('signs in with the username’s address and the CAPTCHA token, then opens the studio', async () => {
    renderRoute('/login', '/login', LoginPage)
    await screen.findByLabelText('Username')
    fill('  Robotik ', 'correct horse')
    submit()
    expect(await screen.findByText('route:/studio')).toBeTruthy()
    expect(fake().db.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'robotik@usmfomo.pages.dev',
      password: 'correct horse',
      options: { captchaToken: 'tok-1' },
    })
  })

  it('goes to the code step when the account has 2FA', async () => {
    fake().db.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue(fake().aal('aal1', 'aal2'))
    fake().db.rpc.mockResolvedValue({ data: { state: 'mfa_required', username: 'robotik' }, error: null })
    renderRoute('/login', '/login', LoginPage)
    await screen.findByLabelText('Username')
    fill('robotik', 'correct horse')
    submit()
    expect(await screen.findByText('route:/login/mfa')).toBeTruthy()
  })

  it('turns the owner account away and signs it out of this browser only', async () => {
    fake().db.rpc.mockResolvedValue({ data: { state: 'owner', username: 'boss' }, error: null })
    renderRoute('/login', '/login', LoginPage)
    await screen.findByLabelText('Username')
    fill('boss', 'correct horse')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('This is the owner account — use the owner console.')
    expect(fake().db.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mock.captcha.reset).toHaveBeenCalled()
  })

  it('explains failures and gets a fresh single-use token', async () => {
    fake().db.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'invalid_credentials', status: 400 } })
    renderRoute('/login', '/login', LoginPage)
    await screen.findByLabelText('Username')
    fill('robotik', 'wrong password')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong username or password.')
    expect(mock.captcha.reset).toHaveBeenCalledTimes(1)
    fake().db.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'user_banned', status: 400 } })
    submit()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This account is paused — contact the usmfomo admin.'))
    expect(mock.captcha.reset).toHaveBeenCalledTimes(2)
  })

  it('sends a tab that is already signed in straight to the studio', async () => {
    const { fakeSession } = await import('../../features/studio/fakeStudioDb.ts')
    fake().setSession(fakeSession())
    renderRoute('/login', '/login', LoginPage)
    expect(await screen.findByText('route:/studio')).toBeTruthy()
  })
})
