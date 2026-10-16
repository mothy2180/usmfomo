import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRow } from '../../lib/api.ts'
import { AnnounceContext } from '../../lib/announce.ts'
import { qk } from '../../lib/queries.ts'
import { AccountDialog } from './AccountDialog.tsx'
import { CreateAccountDialog } from './CreateAccountDialog.tsx'

const api = vi.hoisted(() => ({
  handover: vi.fn(),
  resetPassword: vi.fn(),
  renameAccount: vi.fn(),
  createAccount: vi.fn(),
}))

vi.mock('../../lib/db.ts', () => ({ ownerDb: {}, adminApi: api }))
vi.mock('../../env.ts', () => ({ PUBLIC_SITE_URL: 'https://usmfomo.pages.dev' }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const TYPED = 'Typed by the Owner 2026'

const ACCOUNT: AccountRow = {
  user_id: '9f0c2a5e-5b8e-4d55-9a3c-0c1d2e3f4a5b',
  username: 'robotics-club',
  is_owner: false,
  account_active: true,
  org_id: '22222222-2222-4222-8222-222222222222',
  org_name: 'Robotics Club',
  org_slug: 'robotics-club',
  org_type: 'club',
  org_campus: 'engineering',
  org_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_sign_in_at: null,
  banned_until: null,
  live_posts: 3,
}

function renderUi(ui: ReactNode, announce: (message: string) => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AnnounceContext value={announce}>{ui}</AnnounceContext>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

const submitButton = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).form!

/** The field's state at the moment it receives focus. */
function stateOnFocus(el: HTMLElement): Array<string | null> {
  const seen: Array<string | null> = []
  el.addEventListener('focus', () => seen.push(el.getAttribute('aria-invalid')))
  return seen
}

describe('account actions', () => {
  it('offers edit, change username, reset, hand over, pause and delete, and nothing else', () => {
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={() => {}} />)
    for (const name of ['Edit organisation', 'Change username', 'Reset password', 'Hand over to a new committee', 'Pause account', 'Delete account']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.getAllByRole('button').map((b) => b.textContent)).not.toContain('Resume account')
  })

  it('hands over: a new password that ends every session, shown once', async () => {
    api.handover.mockResolvedValue({ password: 'n'.repeat(24) })
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={() => {}} />)
    expect(screen.getByText('New password, every session ended. Posts stay.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to a new committee' }))
    expect(screen.getByRole('heading', { name: 'Hand over robotics-club to a new committee?' })).toBeTruthy()
    expect(screen.getByText(/gets a new password \(which ends every session\), and is then active\s+again/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand over' }))
    })
    // Left empty: the function generates the password.
    expect(api.handover).toHaveBeenCalledWith(ACCOUNT.user_id, undefined)
    expect(screen.getByText('Handover done: new password, every session of robotics-club ended.')).toBeTruthy()
    expect((screen.getByLabelText('Password for robotics-club') as HTMLInputElement).value).toBe('n'.repeat(24))
  })
})

describe('a password the owner types', () => {
  it('reset: a weak password is refused in place; a typed one is sent and shown once', async () => {
    api.resetPassword.mockImplementation(async (_id: string, password?: string) => ({ password: password ?? 'r'.repeat(24) }))
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const field = screen.getByLabelText('New password') as HTMLInputElement
    expect(field.type).toBe('password')

    fireEvent.change(field, { target: { value: 'short1A' } })
    expect(screen.getByRole('list', { name: 'Password rules' }).textContent).toMatch(/At least 12 characters \(not met\)/)
    const seen = stateOnFocus(field)
    await act(async () => {
      fireEvent.submit(submitButton('Reset password'))
    })
    expect(api.resetPassword).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field)
    expect(seen).toEqual(['true'])

    fireEvent.change(field, { target: { value: TYPED } })
    expect(screen.getByRole('list', { name: 'Password rules' }).textContent).not.toMatch(/not met/)
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(field.type).toBe('text')
    await act(async () => {
      fireEvent.submit(submitButton('Reset password'))
    })
    expect(api.resetPassword).toHaveBeenCalledWith(ACCOUNT.user_id, TYPED)
    expect((screen.getByLabelText('Password for robotics-club') as HTMLInputElement).value).toBe(TYPED)
  })

  it('handover: "Suggest" fills in a strong random password the owner can still edit', async () => {
    api.handover.mockImplementation(async (_id: string, password?: string) => ({ password }))
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to a new committee' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a strong password' }))
    const field = screen.getByLabelText('New password') as HTMLInputElement
    expect(field.value).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{24}$/)
    expect(field.type).toBe('text')
    const edited = `${field.value}x`
    fireEvent.change(field, { target: { value: edited } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hand over' }))
    })
    expect(api.handover).toHaveBeenCalledWith(ACCOUNT.user_id, edited)
  })

  it('create: the typed password goes with the new account', async () => {
    api.createAccount.mockImplementation(async (input: { username: string }, password?: string) => ({
      userId: 'u',
      orgId: 'o',
      username: input.username,
      password,
    }))
    renderUi(<CreateAccountDialog accounts={[ACCOUNT]} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Organisation name'), { target: { value: 'Chess Club' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'chess' } })
    fireEvent.click(screen.getByRole('radio', { name: /Club/ }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: TYPED } })
    await act(async () => {
      fireEvent.submit(submitButton('Create account'))
    })
    expect(api.createAccount).toHaveBeenCalledWith(
      { orgName: 'Chess Club', orgSlug: 'chess-club', username: 'chess', type: 'club', campus: 'main' },
      TYPED,
    )
    expect((screen.getByLabelText('Password for chess') as HTMLInputElement).value).toBe(TYPED)
  })
})

describe('change username', () => {
  const OTHER: AccountRow = { ...ACCOUNT, user_id: 'b0000000-0000-4000-8000-000000000002', username: 'chess', org_id: '33333333-3333-4333-8333-333333333333', org_name: 'Chess Club', org_slug: 'chess' }

  it('checks the new name, explains the effect, renames, updates the cached list and announces it', async () => {
    api.renameAccount.mockResolvedValue({ username: 'robotics-usm' })
    const onClose = vi.fn()
    const announce = vi.fn()
    const { queryClient } = renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT, OTHER]} onClose={onClose} />, announce)
    queryClient.setQueryData(qk.accounts, [ACCOUNT, OTHER])
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }))
    const field = screen.getByLabelText('New username')

    for (const [value, message] of [
      ['has space', /^Use 3–32 characters/],
      ['robotics-club', /^That is already the username\.$/],
      ['Chess', /^Chess Club already uses this username\.$/],
    ] as const) {
      fireEvent.change(field, { target: { value } })
      fireEvent.submit(submitButton('Continue'))
      expect(screen.getAllByRole('alert').some((el) => message.test(el.textContent ?? ''))).toBe(true)
      expect(document.activeElement).toBe(field)
    }

    fireEvent.change(field, { target: { value: ' Robotics-USM ' } })
    fireEvent.submit(submitButton('Continue'))
    expect(screen.getByRole('heading', { name: 'Change robotics-club to robotics-usm?' })).toBeTruthy()
    expect(screen.getByText(/Sessions that are already signed in keep working/)).toBeTruthy()
    expect(api.renameAccount).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change username' }))
    })
    expect(api.renameAccount).toHaveBeenCalledWith(ACCOUNT.user_id, 'robotics-usm')
    expect((queryClient.getQueryData(qk.accounts) as AccountRow[]).map((a) => a.username)).toEqual(['robotics-usm', 'chess'])
    expect(onClose).toHaveBeenCalled()
    expect(announce).toHaveBeenCalledWith('robotics-club is now robotics-usm. They sign in with robotics-usm from now on.')
  })

  it('shows the server’s refusal of a taken name and keeps the dialog open', async () => {
    const { AdminApiError } = await import('../../lib/api.ts')
    api.renameAccount.mockRejectedValue(new AdminApiError('rename_account', 'conflict', 409))
    const onClose = vi.fn()
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }))
    fireEvent.change(screen.getByLabelText('New username'), { target: { value: 'robotics-usm' } })
    fireEvent.submit(submitButton('Continue'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change username' }))
    })
    expect(screen.getByText('Another account already uses that username. Choose another one.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    // Back keeps what was typed.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText('New username') as HTMLInputElement).value).toBe('robotics-usm')
  })
})

describe('form errors are in place before focus moves', () => {
  it('marks the organisation name invalid before focusing it (edit)', () => {
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit organisation' }))
    const name = screen.getByLabelText('Organisation name')
    const seen = stateOnFocus(name)
    fireEvent.change(name, { target: { value: ' ' } })
    fireEvent.submit((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).form!)
    expect(document.activeElement).toBe(name)
    expect(seen).toEqual(['true'])
  })

  it('marks the first invalid field before focusing it (create)', () => {
    renderUi(<CreateAccountDialog accounts={[ACCOUNT]} onClose={() => {}} />)
    const name = screen.getByLabelText('Organisation name')
    const seen = stateOnFocus(name)
    fireEvent.submit((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).form!)
    expect(document.activeElement).toBe(name)
    expect(seen).toEqual(['true'])
    expect(screen.getAllByRole('alert').some((el) => el.textContent === 'This is too short.')).toBe(true)
  })
})
