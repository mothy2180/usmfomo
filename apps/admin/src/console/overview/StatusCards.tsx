import { useId, type ReactNode } from 'react'
import { Badge, Card, ErrorState, Spinner } from '../../components/ui.tsx'
import type { AdminStatus } from '../../lib/api.ts'
import {
  STORAGE_QUOTA_BYTES,
  STORAGE_UPLOAD_CAP_BYTES,
  formatAge,
  formatBytes,
  formatMytDateTime,
  isMaintenanceStale,
  percentOf,
  plural,
} from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { useStatus } from '../../lib/queries.ts'

type StatusQuery = ReturnType<typeof useStatus>

function StatusBody({ status, children }: { status: StatusQuery; children: (data: AdminStatus) => ReactNode }) {
  if (status.isPending) return <Spinner />
  if (status.isError) return <ErrorState message={errorMessage(status.error)} onRetry={() => void status.refetch()} />
  return <>{children(status.data)}</>
}

/** The maintenance heartbeat (written by the hourly cron run). */
export function MaintenanceCard({ status, now }: { status: StatusQuery; now: Date }) {
  const titleId = useId()
  return (
    <Card as="section" labelledBy={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="m-0 text-base font-semibold">
        Maintenance
      </h2>
      <StatusBody status={status}>
        {(data) => {
          const at = data.last_maintenance_at
          const stale = isMaintenanceStale(at, now)
          return (
            <>
              <p className={stale ? 'm-0 text-lg font-semibold text-danger' : 'm-0 text-lg font-semibold'}>
                Last run:{' '}
                {at ? <time dateTime={at}>{formatAge(at, now)}</time> : 'never'}{' '}
                {stale ? <Badge tone="danger">Overdue</Badge> : <Badge tone="ok">On time</Badge>}
              </p>
              {at ? <p className="m-0 text-xs text-muted">{formatMytDateTime(at)}</p> : null}
              {stale ? (
                <p className="m-0 text-sm">
                  The hourly clean-up hasn't run for more than 3 hours. Ended posts are still hidden from the public at
                  once, but their rows and poster files are not being deleted, and without traffic Supabase may pause the
                  project after about 7 days. Check the usmfomo-cron Worker logs.
                </p>
              ) : (
                <p className="m-0 text-sm text-muted">The usmfomo-cron Worker runs it at minute 7 of every hour.</p>
              )}
              <LastResult result={data.last_maintenance_result} />
            </>
          )
        }}
      </StatusBody>
    </Card>
  )
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** "Last result: 3 posts and 1 notice purged, 6 files removed." (when the shape is known). */
function LastResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null
  const r = result as { purged?: { posts?: unknown; notices?: unknown }; files?: unknown; orphans?: unknown }
  const posts = num(r.purged?.posts)
  const notices = num(r.purged?.notices)
  const files = num(r.files)
  const orphans = num(r.orphans)
  const parts: string[] = []
  if (posts !== null || notices !== null) {
    parts.push(`${plural(posts ?? 0, 'post')} and ${plural(notices ?? 0, 'notice')} purged`)
  }
  if (files !== null) parts.push(`${plural(files, 'file')} removed`)
  if (orphans !== null && orphans > 0) parts.push(`${plural(orphans, 'orphaned file')} swept`)
  if (!parts.length) return null
  return <p className="m-0 text-xs text-muted">Last result: {parts.join(', ')}.</p>
}

export function StorageCard({ status }: { status: StatusQuery }) {
  const titleId = useId()
  const meterId = useId()
  return (
    <Card as="section" labelledBy={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="m-0 text-base font-semibold">
        Poster storage
      </h2>
      <StatusBody status={status}>
        {(data) => {
          const pct = percentOf(data.storage_bytes, STORAGE_QUOTA_BYTES)
          return (
            <>
              <label htmlFor={meterId} className="text-sm">
                {formatBytes(data.storage_bytes)} of 1 GB used ({pct}%)
              </label>
              <meter
                id={meterId}
                className="usage-meter"
                min={0}
                max={STORAGE_QUOTA_BYTES}
                low={STORAGE_QUOTA_BYTES * 0.5}
                high={STORAGE_QUOTA_BYTES * 0.7}
                optimum={0}
                value={data.storage_bytes}
              >
                {pct}%
              </meter>
              <p className="m-0 text-sm">{plural(data.storage_objects, 'file')} in the posters bucket</p>
              <p className="m-0 text-xs text-muted">
                New uploads stop at {formatBytes(STORAGE_UPLOAD_CAP_BYTES)} (database cap), keeping the free 1 GB safe.
              </p>
            </>
          )
        }}
      </StatusBody>
    </Card>
  )
}

export function ContentCard({ status }: { status: StatusQuery }) {
  const titleId = useId()
  return (
    <Card as="section" labelledBy={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="m-0 text-base font-semibold">
        Content
      </h2>
      <StatusBody status={status}>
        {(data) => (
          <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
            <dt className="text-2xl font-bold">{data.live_posts}</dt>
            <dd className="m-0 text-sm">
              posts not yet ended (<a href="#moderation" className="text-sky underline">moderate</a>)
            </dd>
            <dt className="text-2xl font-bold">{data.live_notices}</dt>
            <dd className="m-0 text-sm">
              notices live or scheduled (<a href="#notices" className="text-sky underline">manage</a>)
            </dd>
          </dl>
        )}
      </StatusBody>
    </Card>
  )
}
