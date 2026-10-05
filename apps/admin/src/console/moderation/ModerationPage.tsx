import { useDeferredValue, useId, useMemo, useState } from 'react'
import { PageHeading } from '../../components/PageHeading.tsx'
import { Button, Callout, EmptyState, ErrorState, Field, Input, Spinner } from '../../components/ui.tsx'
import { plural } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { countByStatus, filterPosts, POST_STATUS_LABELS, type PostStatus } from '../../lib/posts.ts'
import { usePosts, type ModPost } from '../../lib/queries.ts'
import { useNow } from '../../lib/useNow.ts'
import { PostActionDialog, type PostAction } from './PostActionDialog.tsx'
import { PostCard } from './PostCard.tsx'

type StatusFilter = PostStatus | 'all'

const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'live', label: POST_STATUS_LABELS.live },
  { value: 'hidden', label: POST_STATUS_LABELS.hidden },
  { value: 'expired', label: POST_STATUS_LABELS.expired },
  { value: 'cancelled', label: POST_STATUS_LABELS.cancelled },
]

/** Cards rendered at a time; "Show more" adds another batch. */
const BATCH = 50

export function ModerationPage() {
  const posts = usePosts()
  const now = useNow(60_000)
  const filterId = useId()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [limit, setLimit] = useState(BATCH)
  const [target, setTarget] = useState<{ post: ModPost; action: PostAction } | null>(null)
  const query = useDeferredValue(q)

  const rows = useMemo(() => posts.data?.rows ?? [], [posts.data])
  const counts = useMemo(() => countByStatus(rows, now), [rows, now])
  const filtered = useMemo(() => filterPosts(rows, { q: query, status }, now), [rows, query, status, now])
  const shown = filtered.slice(0, limit)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>Moderation</PageHeading>
        <Button onClick={() => void posts.refetch()} busy={posts.isFetching && !posts.isPending}>
          Refresh
        </Button>
      </div>
      <p className="m-0 max-w-3xl text-sm text-muted">
        Every post, newest first, including hidden ones and ended ones the hourly clean-up hasn’t deleted yet. Hiding takes
        a post off the public site at once. Deleting or removing an image deletes the files at once, but copies already
        cached can stay reachable for up to 6 hours (there is no cache purge on the free plan).
      </p>

      <search aria-label="Filter posts" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <Field label="Search" hint="Title, venue or organisation">
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.currentTarget.value)
                setLimit(BATCH)
              }}
              aria-describedby={describedBy}
              autoComplete="off"
              className="max-w-md"
            />
          )}
        </Field>
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold">Status</legend>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <label
                key={f.value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm has-checked:border-sky has-checked:bg-surface-2 has-checked:font-semibold"
              >
                <input
                  type="radio"
                  name={`${filterId}-status`}
                  value={f.value}
                  checked={status === f.value}
                  onChange={() => {
                    setStatus(f.value)
                    setLimit(BATCH)
                  }}
                  className="h-4 w-4 accent-accent"
                />
                {f.label}
                <span className="tabular-nums text-muted">{posts.data ? counts[f.value] : '…'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </search>

      {posts.isPending ? <Spinner label="Loading posts…" /> : null}
      {posts.isError ? <ErrorState message={errorMessage(posts.error)} onRetry={() => void posts.refetch()} /> : null}
      {posts.data?.truncated ? (
        <Callout tone="warn" title="Only the newest posts are listed">
          <p className="m-0">There are more than {rows.length} posts; older ones are not loaded here.</p>
        </Callout>
      ) : null}

      {posts.data ? (
        <>
          <output className="block text-sm">
            {filtered.length === rows.length
              ? plural(rows.length, 'post')
              : `${filtered.length} of ${plural(rows.length, 'post')} match`}
            {shown.length < filtered.length ? ` · showing the newest ${shown.length}` : ''}
          </output>
          {shown.length ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {shown.map((post) => (
                <PostCard key={post.id} post={post} now={now} onAction={(action) => setTarget({ post, action })} />
              ))}
            </ul>
          ) : (
            <EmptyState title={rows.length ? 'No posts match' : 'No posts yet'}>
              {rows.length ? 'Change the search or the status filter.' : 'Posts appear here as soon as a club or school publishes one.'}
            </EmptyState>
          )}
          {filtered.length > shown.length ? (
            <Button onClick={() => setLimit((n) => n + BATCH)} className="self-start">
              Show {Math.min(BATCH, filtered.length - shown.length)} more
            </Button>
          ) : null}
        </>
      ) : null}

      {target ? (
        <PostActionDialog key={`${target.post.id}-${target.action}`} post={target.post} action={target.action} onClose={() => setTarget(null)} />
      ) : null}
    </>
  )
}
