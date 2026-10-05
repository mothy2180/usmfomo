import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../lib/i18n.ts'
import { ORG } from './fakeStudioDb.ts'
import { PostForm } from './PostForm.tsx'
import { renderRoute } from './renderRoute.tsx'
import type { PostRow } from './types.ts'

const ports = vi.hoisted(() => ({
  upload: vi.fn(async (_path: string, _file: Blob, _type: string) => {}),
  remove: vi.fn(async (_paths: string[]) => {}),
  insert: vi.fn(async (_row: unknown) => ({ id: '22222222-2222-4222-8222-222222222222' })),
  update: vi.fn(async (_id: string, _patch: unknown) => {}),
  delete: vi.fn(async (_id: string) => {}),
}))

vi.mock('./ports.ts', () => ({ studioPorts: ports }))
vi.mock('../../lib/db.ts', () => ({
  studioDb: {},
  imageSrc: (path: string | null | undefined) => (path ? `/i/${path}` : undefined),
  onImageError: () => {},
}))
vi.mock('../../env.ts', () => ({ CONTACT_URL: '' }))

const NOW = new Date('2026-10-05T02:00:00Z') // Mon 5 Oct, 10:00 MYT
const OLD_POSTER = `${ORG.id}/44444444-4444-4444-8444-444444444444.webp`
const OLD_THUMB = `${ORG.id}/44444444-4444-4444-8444-444444444444-thumb.webp`

const existing: PostRow = {
  id: '22222222-2222-4222-8222-222222222222',
  org_id: ORG.id,
  campus: 'engineering',
  title: 'Hack Night',
  venue: 'DK A',
  description: null,
  link_url: null,
  starts_at: '2026-10-11T12:00:00+00:00',
  ends_at: '2026-10-11T14:00:00+00:00',
  poster_path: OLD_POSTER,
  thumb_path: OLD_THUMB,
  cancelled_at: null,
  hidden_at: null,
  details_changed_at: null,
  created_at: '2026-10-01T00:00:00+00:00',
  updated_at: '2026-10-01T00:00:00+00:00',
}

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

function fillValid() {
  change('Event name', 'Hack Night')
  change('Start date', '2026-10-11')
  change('Start time', '20:00')
  change('End time', '22:00')
  change('Venue', 'DK A')
  change('Registration link (optional)', 'https://forms.gle/abc')
}

const renderForm = (props: Partial<Parameters<typeof PostForm>[0]> = {}) =>
  renderRoute('/studio/new', '/studio/new', () => <PostForm org={ORG} postingEnabled {...props} />)

describe('PostForm', () => {
  beforeAll(async () => {
    window.scrollTo = () => {}
    URL.createObjectURL = vi.fn(() => 'blob:poster')
    URL.revokeObjectURL = vi.fn()
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  afterAll(() => vi.restoreAllMocks())

  it('marks every missing field, announces it and focuses the first one', async () => {
    renderForm()
    await screen.findByLabelText('Event name')
    expect(screen.getByText('Times are Malaysia time (MYT)')).toBeTruthy()
    // Campus defaults to the organisation's own.
    expect((screen.getByLabelText('Campus') as HTMLSelectElement).value).toBe('engineering')
    click('Preview')
    expect((await screen.findByRole('alert')).textContent).toBe('Please check the highlighted fields.')
    for (const label of ['Event name', 'Start date', 'Start time', 'End date', 'End time', 'Venue']) {
      expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true')
    }
    expect(screen.getAllByText('Required.')).toHaveLength(6)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Event name')))
    // The error is tied to its field.
    const describedBy = screen.getByLabelText('Event name').getAttribute('aria-describedby') ?? ''
    expect(describedBy.split(' ').some((id) => document.getElementById(id)?.textContent === 'Required.')).toBe(true)
  })

  it('previews, then publishes the exact row once', async () => {
    renderForm()
    await screen.findByLabelText('Event name')
    fillValid()
    // The end date followed the start date.
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-10-11')
    click('Preview')
    expect(await screen.findByText('This goes live immediately.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Hack Night' })).toBeTruthy()
    expect(screen.getByText('Sun 11 Oct · 8:00–10:00 PM')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Registration link/ }).getAttribute('rel')).toBe('noopener noreferrer nofollow ugc')
    // A double click publishes once (the button turns busy and disabled).
    const publish = screen.getByRole('button', { name: 'Publish' })
    fireEvent.click(publish)
    fireEvent.click(publish)
    expect(publish.getAttribute('aria-busy')).toBe('true')
    expect(await screen.findByRole('heading', { name: 'Published' })).toBeTruthy()
    expect(ports.insert).toHaveBeenCalledTimes(1)
    expect(ports.insert).toHaveBeenCalledWith({
      title: 'Hack Night',
      venue: 'DK A',
      campus: 'engineering',
      description: null,
      link_url: 'https://forms.gle/abc',
      starts_at: '2026-10-11T12:00:00.000Z',
      ends_at: '2026-10-11T14:00:00.000Z',
      poster_path: null,
      thumb_path: null,
    })
    expect(ports.upload).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'View public page' }).getAttribute('href')).toBe('/e/22222222-2222-4222-8222-222222222222')
  })

  it('offers "ends next day" for an overnight event', async () => {
    renderForm()
    await screen.findByLabelText('Event name')
    change('Start date', '2026-10-11')
    change('Start time', '22:00')
    change('End time', '02:00')
    expect(screen.getByText('Ends next day?')).toBeTruthy()
    click('Set the end date to Mon 12 Oct')
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-10-12')
    expect(screen.queryByText('Ends next day?')).toBeNull()
  })

  it('shows the database’s answer and stays on the preview', async () => {
    ports.insert.mockRejectedValueOnce({ code: 'P0001', message: 'quota_daily' })
    renderForm()
    await screen.findByLabelText('Event name')
    fillValid()
    click('Preview')
    await screen.findByText('This goes live immediately.')
    click('Publish')
    expect((await screen.findByRole('alert')).textContent).toBe("You've made 5 new posts in the last 24 hours. Try again later.")
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy()
  })

  it('disables uploads and publishing while posting is paused', async () => {
    renderForm({ postingEnabled: false })
    await screen.findByLabelText('Event name')
    expect(screen.getByText(/Posting is paused by the usmfomo admin/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Poster (optional)') as HTMLInputElement).disabled).toBe(true)
  })

  it('edits: removes the poster in the same update, then deletes its files; can mark cancelled', async () => {
    renderForm({ post: existing })
    await screen.findByLabelText('Event name')
    expect((screen.getByLabelText('Event name') as HTMLInputElement).value).toBe('Hack Night')
    expect(screen.getByText('Current poster')).toBeTruthy()
    click('Remove poster')
    expect(screen.getByText('The poster will be removed when you save.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Mark as cancelled'))
    click('Preview')
    expect(await screen.findByText('Your changes go live immediately.')).toBeTruthy()
    expect(screen.getByText('Cancelled')).toBeTruthy()
    click('Save changes')
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy()
    expect(ports.update).toHaveBeenCalledWith(existing.id, { cancelled_at: NOW.toISOString(), poster_path: null, thumb_path: null })
    expect(ports.remove).toHaveBeenCalledWith([OLD_POSTER, OLD_THUMB])
    expect(ports.update.mock.invocationCallOrder[0]!).toBeLessThan(ports.remove.mock.invocationCallOrder[0]!)
  })

  it('edits: says so when nothing changed (no wasted edit)', async () => {
    renderForm({ post: existing })
    await screen.findByLabelText('Event name')
    click('Preview')
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing has changed yet.')
    expect(ports.update).not.toHaveBeenCalled()
  })
})
