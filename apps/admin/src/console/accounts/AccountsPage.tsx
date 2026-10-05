import { useState } from 'react'
import { PageHeading } from '../../components/PageHeading.tsx'
import { Button, Callout, EmptyState, ErrorState, Spinner } from '../../components/ui.tsx'
import type { AccountRow } from '../../lib/api.ts'
import { plural } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { useAccounts } from '../../lib/queries.ts'
import { useNow } from '../../lib/useNow.ts'
import { AccountDialog } from './AccountDialog.tsx'
import { accountSummary, RECENT_FACTOR_DAYS } from './accountForms.ts'
import { AccountsTable } from './AccountsTable.tsx'
import { CreateAccountDialog } from './CreateAccountDialog.tsx'

export function AccountsPage() {
  const accounts = useAccounts()
  const now = useNow(60_000)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState<AccountRow | null>(null)
  const rows = accounts.data ?? []
  // The dialog follows fresh data, but keeps its snapshot if the row disappears.
  const managed = managing ? (rows.find((r) => r.user_id === managing.user_id) ?? managing) : null

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>Accounts</PageHeading>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void accounts.refetch()} busy={accounts.isFetching && !accounts.isPending}>
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            Create account
          </Button>
        </div>
      </div>
      <p className="m-0 max-w-3xl text-sm text-muted">
        One account per club or school. New accounts get a random password that you see once and pass on through the
        club’s official channel. Use Manage for password resets, handovers to a new committee, pausing and deleting.
      </p>

      {accounts.isPending ? <Spinner label="Loading accounts…" /> : null}
      {accounts.isError ? <ErrorState message={errorMessage(accounts.error)} onRetry={() => void accounts.refetch()} /> : null}
      {accounts.data ? <Summary rows={rows} now={now} /> : null}
      {accounts.data && rows.length ? <AccountsTable rows={rows} now={now} onManage={setManaging} /> : null}
      {accounts.data && !rows.length ? (
        <EmptyState title="No accounts yet">Create the owner with the CLI first, then add clubs and schools here.</EmptyState>
      ) : null}

      {creating ? <CreateAccountDialog accounts={rows} onClose={() => setCreating(false)} /> : null}
      {managed ? (
        <AccountDialog key={managed.user_id} account={managed} accounts={rows} onClose={() => setManaging(null)} />
      ) : null}
    </>
  )
}

function Summary({ rows, now }: { rows: AccountRow[]; now: Date }) {
  const s = accountSummary(rows, now)
  return (
    <>
      <p className="m-0 text-sm">
        {plural(s.total, 'club and school account', 'club and school accounts')}
        {s.paused ? ` · ${s.paused} paused` : ''}
        {s.inactiveOrgs ? ` · ${plural(s.inactiveOrgs, 'organisation')} inactive` : ''}
      </p>
      {s.recentFactor.length ? (
        <Callout tone="warn" title={`2FA devices added in the last ${RECENT_FACTOR_DAYS} days`}>
          <p className="m-0">
            {s.recentFactor.map((r) => r.username).join(', ')}. Check that each one was expected: someone with a stolen
            password could add their own device. If in doubt about a club, use Hand over; for your own account, use the
            owner CLI.
          </p>
        </Callout>
      ) : null}
    </>
  )
}
