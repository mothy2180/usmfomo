import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { PageHeading } from '../../components/PageHeading.tsx'
import { Badge, Button, EmptyState, ErrorState, Spinner, type Tone } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { formatMytDateTime } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { groupNotices, NOTICE_STATUS_LABELS, NOTICE_STATUSES, noticeStatus, type NoticeStatus } from '../../lib/notices.ts'
import { deleteNotice, qk, useNotices, type NoticeRow } from '../../lib/queries.ts'
import { useNow } from '../../lib/useNow.ts'
import { NoticeDialog } from './NoticeDialog.tsx'

const TONES: Record<NoticeStatus, Tone> = { live: 'ok', scheduled: 'sky', expired: 'neutral' }

const SECTION_HINTS: Record<NoticeStatus, string> = {
  live: 'Shown at the top of the public dashboard now.',
  scheduled: 'Shown from their start time.',
  expired: 'No longer shown; the hourly clean-up deletes them.',
}

export function NoticesPage() {
  const notices = useNotices()
  const now = useNow(30_000)
  const [editing, setEditing] = useState<NoticeRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<NoticeRow | null>(null)
  const groups = useMemo(() => groupNotices(notices.data ?? [], now), [notices.data, now])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>Notices</PageHeading>
        <Button variant="primary" onClick={() => setEditing('new')}>
          New notice
        </Button>
      </div>
      <p className="m-0 max-w-3xl text-sm text-muted">
        Announcements from usmfomo, shown at the top of the public dashboard between their start and end. Times are
        Malaysia time (MYT).
      </p>

      {notices.isPending ? <Spinner label="Loading notices…" /> : null}
      {notices.isError ? <ErrorState message={errorMessage(notices.error)} onRetry={() => void notices.refetch()} /> : null}
      {notices.data && !notices.data.length ? (
        <EmptyState title="No notices">The public dashboard hides the notice strip when none is live.</EmptyState>
      ) : null}
      {notices.data?.length
        ? NOTICE_STATUSES.map((status) =>
            groups[status].length ? (
              <NoticeGroup
                key={status}
                status={status}
                rows={groups[status]}
                now={now}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            ) : null,
          )
        : null}

      {editing ? <NoticeDialog notice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteNotice notice={deleting} onClose={() => setDeleting(null)} /> : null}
    </>
  )
}

function NoticeGroup({
  status,
  rows,
  now,
  onEdit,
  onDelete,
}: {
  status: NoticeStatus
  rows: NoticeRow[]
  now: Date
  onEdit: (n: NoticeRow) => void
  onDelete: (n: NoticeRow) => void
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h2 id={headingId} className="m-0 text-lg font-semibold">
          {NOTICE_STATUS_LABELS[status]} ({rows.length})
        </h2>
        <p className="m-0 text-xs text-muted">{SECTION_HINTS[status]}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((n) => (
          <NoticeCard key={n.id} notice={n} now={now} onEdit={() => onEdit(n)} onDelete={() => onDelete(n)} />
        ))}
      </ul>
    </section>
  )
}

function NoticeCard({ notice: n, now, onEdit, onDelete }: { notice: NoticeRow; now: Date; onEdit: () => void; onDelete: () => void }) {
  const titleId = useId()
  const status = noticeStatus(n, now)
  const which = <span className="sr-only"> “{n.title}”</span>
  return (
    <li>
      <article aria-labelledby={titleId} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={titleId} className="m-0 min-w-0 break-words text-base font-semibold">
            {n.title}
          </h3>
          <Badge tone={TONES[status]}>{NOTICE_STATUS_LABELS[status]}</Badge>
        </div>
        <p className="m-0 whitespace-pre-line break-words text-sm">{n.body}</p>
        {n.link_url ? (
          <p className="m-0 text-sm">
            <ExternalLink href={n.link_url}>Link</ExternalLink>
          </p>
        ) : null}
        <p className="m-0 text-xs text-muted">
          Shown from <time dateTime={n.starts_at}>{formatMytDateTime(n.starts_at)}</time> until{' '}
          <time dateTime={n.ends_at}>{formatMytDateTime(n.ends_at)}</time> (MYT) · updated {formatMytDateTime(n.updated_at)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onEdit}>Edit{which}</Button>
          <Button variant="danger" onClick={onDelete}>
            Delete{which}
          </Button>
        </div>
      </article>
    </li>
  )
}

function DeleteNotice({ notice, onClose }: { notice: NoticeRow; onClose: () => void }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const mutation = useMutation({
    mutationFn: () => deleteNotice(notice.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notices })
      void queryClient.invalidateQueries({ queryKey: qk.status })
      onClose()
      announce('Notice deleted.')
    },
  })
  return (
    <ConfirmDialog
      open
      title={`Delete the notice “${notice.title}”?`}
      confirmLabel="Delete notice"
      busy={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    >
      <p className="m-0">It disappears from the public dashboard at once. This can’t be undone.</p>
    </ConfirmDialog>
  )
}
