import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnounceContext } from '../../lib/announce.ts'
import type { ModPost } from '../../lib/queries.ts'
import { PostActionDialog, type PostAction } from './PostActionDialog.tsx'

const api = vi.hoisted(() => ({ deletePost: vi.fn(), removePostImage: vi.fn() }))

vi.mock('../../lib/db.ts', () => ({ ownerDb: {}, adminApi: api }))

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const POST = {
  id: '0e5b8a1c-1111-4c2d-9e3f-123456789abc',
  org_id: ORG_ID,
  campus: 'main',
  title: 'Robotics night',
  venue: 'DK A',
  description: null,
  link_url: null,
  starts_at: '2026-10-10T10:00:00Z',
  ends_at: '2026-10-10T12:00:00Z',
  poster_path: `${ORG_ID}/7f1c.webp`,
  thumb_path: `${ORG_ID}/7f1c-thumb.webp`,
  cancelled_at: null,
  hidden_at: null,
  created_at: '2026-10-05T00:00:00Z',
  updated_at: '2026-10-05T00:00:00Z',
  org: { id: ORG_ID, name: 'Robotics Club', slug: 'robotics-club', type: 'club', active: true },
} as unknown as ModPost

function renderDialog(action: PostAction) {
  const onClose = vi.fn()
  const announce = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AnnounceContext value={announce}>
        <PostActionDialog post={POST} action={action} onClose={onClose} />
      </AnnounceContext>
    </QueryClientProvider>,
  )
  return { onClose, announce }
}

async function confirm(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('PostActionDialog: poster files Storage refused to delete', () => {
  it('confirms a delete when every file was removed', async () => {
    api.deletePost.mockResolvedValue({ removedFiles: 2, failedFiles: 0 })
    const { onClose, announce } = renderDialog('delete')
    await confirm('Delete post')
    expect(api.deletePost).toHaveBeenCalledWith(POST.id)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(announce).toHaveBeenCalledWith('Post deleted, with 2 poster files.')
  })

  it('warns instead of confirming when files are left after a delete', async () => {
    api.deletePost.mockResolvedValue({ removedFiles: 0, failedFiles: 2 })
    const { onClose, announce } = renderDialog('delete')
    await confirm('Delete post')
    expect(onClose).not.toHaveBeenCalled()
    expect(announce).not.toHaveBeenCalled()
    const title = screen.getByRole('heading', { name: 'Post deleted, but 2 files are still public' })
    // Focus moves to the new title, so the warning is read out.
    expect(document.activeElement).toBe(title)
    expect(screen.getByText(/stay public at their addresses until the daily clean-up/)).toBeTruthy()
    expect(screen.getByText(POST.poster_path!)).toBeTruthy()
    expect(screen.getByText(POST.thumb_path!)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('warns when one file is left after removing an image', async () => {
    api.removePostImage.mockResolvedValue({ removedFiles: 1, failedFiles: 1 })
    const { onClose, announce } = renderDialog('remove_image')
    await confirm('Remove image')
    expect(onClose).not.toHaveBeenCalled()
    expect(announce).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Image removed, but a file is still public' })).toBeTruthy()
    expect(screen.getByText(/It stays public at its address until the daily clean-up deletes it/)).toBeTruthy()
  })

  it('confirms an image removal when every file was removed', async () => {
    api.removePostImage.mockResolvedValue({ removedFiles: 2, failedFiles: 0 })
    const { onClose, announce } = renderDialog('remove_image')
    await confirm('Remove image')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(announce).toHaveBeenCalledWith('Image removed (2 files deleted).')
  })
})
