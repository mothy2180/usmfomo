import { useId } from 'react'
import { Badge, Button } from '../../components/ui.tsx'
import type { AccountRow } from '../../lib/api.ts'
import { formatAge, formatMytDateTime, plural } from '../../lib/format.ts'
import { CAMPUS_LABELS, TYPE_LABELS } from '../../lib/labels.ts'
import { hasRecentFactor } from './accountForms.ts'

const cell = 'px-3 py-2 align-top'

/** A data table; at narrow widths it scrolls sideways inside its own
 * keyboard-focusable region, so the page itself still reflows at 320 px.
 * The region is `relative` so absolutely positioned descendants (sr-only
 * labels) are clipped by it instead of widening the page. */
export function AccountsTable({ rows, now, onManage }: { rows: AccountRow[]; now: Date; onManage: (row: AccountRow) => void }) {
  const captionId = useId()
  return (
    <section
      aria-labelledby={captionId}
      // A scrollable region must be keyboard-focusable so it can be scrolled
      // sideways without a mouse (WCAG 2.1.1).
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className="relative overflow-x-auto rounded-xl border border-line"
    >
      <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
        <caption id={captionId} className="sr-only">
          Accounts, owner first
        </caption>
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th scope="col" className={cell}>
              Username
            </th>
            <th scope="col" className={cell}>
              Organisation
            </th>
            <th scope="col" className={cell}>
              Type
            </th>
            <th scope="col" className={cell}>
              Campus
            </th>
            <th scope="col" className={cell}>
              Status
            </th>
            <th scope="col" className={cell}>
              2FA devices
            </th>
            <th scope="col" className={cell}>
              Last sign-in
            </th>
            <th scope="col" className={`${cell} text-right`}>
              Live posts
            </th>
            <th scope="col" className={cell}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.user_id} row={row} now={now} onManage={onManage} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Row({ row, now, onManage }: { row: AccountRow; now: Date; onManage: (row: AccountRow) => void }) {
  const recent = hasRecentFactor(row, now)
  return (
    <tr className="border-t border-line">
      <th scope="row" className={`${cell} font-normal`}>
        <span className="break-words font-mono font-semibold">{row.username}</span>
        {row.is_owner ? (
          <span className="mt-1 block">
            <Badge tone="sky">Owner</Badge>
          </span>
        ) : null}
      </th>
      <td className={cell}>
        {row.org_name ? (
          <>
            <span className="block">{row.org_name}</span>
            <span className="block break-all font-mono text-xs text-muted">/o/{row.org_slug}</span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className={cell}>{row.org_type ? TYPE_LABELS[row.org_type] : '—'}</td>
      <td className={cell}>{row.org_campus ? CAMPUS_LABELS[row.org_campus] : '—'}</td>
      <td className={cell}>
        <span className="flex flex-wrap gap-1">
          {row.account_active ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Paused</Badge>}
          {row.org_active === false ? <Badge tone="danger">Org inactive</Badge> : null}
        </span>
      </td>
      <td className={cell}>
        {row.factor_count > 0 ? (
          <>
            <span className="block">{plural(row.factor_count, 'device')}</span>
            <span className={recent ? 'block text-xs font-semibold text-accent' : 'block text-xs text-muted'}>
              newest {formatMytDateTime(row.newest_factor_at)}
            </span>
            {recent ? (
              <span className="mt-1 block">
                <Badge tone="accent">Added in the last 7 days</Badge>
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted">None</span>
        )}
      </td>
      <td className={cell}>
        {row.last_sign_in_at ? (
          <time dateTime={row.last_sign_in_at}>
            <span className="block">{formatAge(row.last_sign_in_at, now)}</span>
            <span className="block text-xs text-muted">{formatMytDateTime(row.last_sign_in_at)}</span>
          </time>
        ) : (
          <span className="text-muted">Never</span>
        )}
      </td>
      <td className={`${cell} text-right tabular-nums`}>{row.is_owner ? '—' : row.live_posts}</td>
      <td className={cell}>
        {row.is_owner ? (
          <span className="text-xs text-muted">Owner CLI only</span>
        ) : (
          <Button onClick={() => onManage(row)} className="whitespace-nowrap">
            Manage<span className="sr-only"> {row.username}</span>
          </Button>
        )}
      </td>
    </tr>
  )
}
