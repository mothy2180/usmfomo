import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeDialog } from './NoticeDialog.tsx'

vi.mock('../../lib/db.ts', () => ({ ownerDb: {}, adminApi: {} }))

afterEach(cleanup)

describe('NoticeDialog', () => {
  it('marks the first invalid field, with its error, before focusing it', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NoticeDialog notice={null} onClose={() => {}} />
      </QueryClientProvider>,
    )
    const title = screen.getByLabelText('Title')
    const seen: Array<{ invalid: string | null; describedBy: string }> = []
    title.addEventListener('focus', () =>
      seen.push({ invalid: title.getAttribute('aria-invalid'), describedBy: title.getAttribute('aria-describedby') ?? '' }),
    )
    fireEvent.submit((screen.getByRole('button', { name: 'Create notice' }) as HTMLButtonElement).form!)
    expect(document.activeElement).toBe(title)
    expect(seen[0]?.invalid).toBe('true')
    const errorId = seen[0]?.describedBy.split(' ').find((id) => id.endsWith('-err'))
    expect(errorId && document.getElementById(errorId)?.getAttribute('role')).toBe('alert')
  })
})
