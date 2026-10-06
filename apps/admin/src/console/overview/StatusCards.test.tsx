import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminStatus } from '../../lib/api.ts'
import type { useStatus } from '../../lib/queries.ts'
import { MaintenanceCard } from './StatusCards.tsx'

vi.mock('../../lib/db.ts', () => ({ ownerDb: {}, adminApi: {} }))

afterEach(cleanup)

const now = new Date('2026-10-06T06:00:00Z')
const HOUR = 60 * 60_000
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

function statusWith(result: unknown, lastRunAt: string | null = ago(HOUR - 7 * 60_000)) {
  const data: AdminStatus = {
    last_maintenance_at: lastRunAt,
    last_maintenance_result: result,
    live_posts: 4,
    live_notices: 1,
    storage_objects: 8,
    storage_bytes: 1024,
    settings: null,
  }
  return { isPending: false, isError: false, data } as unknown as ReturnType<typeof useStatus>
}

const CLEAN = {
  ok: true,
  purged: { posts: 3, notices: 1 },
  files: 6,
  orphans: null,
  retention: null,
  failed: [],
  at: ago(HOUR),
  swept_at: ago(11 * HOUR),
}

const badges = () => ['On time', 'Overdue', 'Failed'].filter((label) => screen.queryByText(label))

describe('MaintenanceCard', () => {
  it('shows a clean, recent run as on time', () => {
    render(<MaintenanceCard status={statusWith(CLEAN)} now={now} />)
    expect(badges()).toEqual(['On time'])
    expect(screen.getByText('Last result: 3 posts and 1 notice purged, 6 files removed.')).toBeTruthy()
    expect(screen.getByText(/Daily sweep \(orphaned files, old logs\): last completed/)).toBeTruthy()
  })

  it('shows a failed run in red even though the heartbeat is recent', () => {
    const failed = { ...CLEAN, ok: false, files: 0, failed: ['files', 'orphans'] }
    render(<MaintenanceCard status={statusWith(failed)} now={now} />)
    expect(badges()).toEqual(['Failed'])
    expect(
      screen.getByText(/The last run failed at: deleting the poster files of purged posts, the daily sweep of orphaned poster files\./),
    ).toBeTruthy()
  })

  it('shows both badges when the run is overdue and failed', () => {
    render(<MaintenanceCard status={statusWith({ ...CLEAN, ok: false, failed: ['purge'] }, ago(5 * HOUR))} now={now} />)
    expect(badges()).toEqual(['Overdue', 'Failed'])
  })

  it('warns when the daily sweep has not completed for more than 26 hours', () => {
    render(<MaintenanceCard status={statusWith({ ...CLEAN, swept_at: ago(30 * HOUR) })} now={now} />)
    expect(screen.getByText(/Daily sweep \(orphaned files, old logs\): overdue, last completed/)).toBeTruthy()
  })

  it('still works before the first run and with an older result shape', () => {
    render(<MaintenanceCard status={statusWith(null, null)} now={now} />)
    expect(badges()).toEqual(['Overdue'])
    cleanup()
    render(<MaintenanceCard status={statusWith({ purged: { posts: 1, notices: 0 }, files: 2 })} now={now} />)
    expect(badges()).toEqual(['On time'])
    expect(screen.queryByText(/Daily sweep/)).toBeNull()
  })
})
