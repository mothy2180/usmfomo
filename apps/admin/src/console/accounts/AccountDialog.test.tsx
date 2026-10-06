import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRow } from '../../lib/api.ts'
import { AccountDialog } from './AccountDialog.tsx'
import { CreateAccountDialog } from './CreateAccountDialog.tsx'

vi.mock('../../lib/db.ts', () => ({ ownerDb: {}, adminApi: {} }))
vi.mock('../../env.ts', () => ({ PUBLIC_SITE_URL: 'https://usmfomo.pages.dev' }))

afterEach(cleanup)

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
  factor_count: 2,
  newest_factor_at: '2026-09-01T00:00:00Z',
  live_posts: 3,
}

function renderUi(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/** The field's state at the moment it receives focus. */
function stateOnFocus(el: HTMLElement): Array<string | null> {
  const seen: Array<string | null> = []
  el.addEventListener('focus', () => seen.push(el.getAttribute('aria-invalid')))
  return seen
}

describe('Remove 2FA devices', () => {
  it('points to Hand over, or to resetting the password first', () => {
    renderUi(<AccountDialog account={ACCOUNT} accounts={[ACCOUNT]} onClose={() => {}} />)
    expect(screen.getByText(/For a lost phone, use Hand over, or reset the password first/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2FA devices' }))
    expect(screen.getByRole('heading', { name: 'Remove all 2FA devices of robotics-club?' })).toBeTruthy()
    expect(screen.getByText(/The password stays and no session ends/)).toBeTruthy()
    expect(screen.getByText(/use Hand over instead: it changes the password \(ending every session\) before removing/)).toBeTruthy()
    expect(screen.getByText(/Or reset the password first, then remove the devices/)).toBeTruthy()
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
