import { useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { PageHeading } from '../../components/PageHeading.tsx'
import { Button, Callout, Card } from '../../components/ui.tsx'
import { qk, useStatus } from '../../lib/queries.ts'
import { useNow } from '../../lib/useNow.ts'
import { DevicesCard } from './DevicesCard.tsx'
import { KillSwitches } from './KillSwitches.tsx'
import { ContentCard, MaintenanceCard, StorageCard } from './StatusCards.tsx'

export function OverviewPage() {
  const status = useStatus()
  const queryClient = useQueryClient()
  const now = useNow(30_000)
  const weeklyId = useId()
  const refresh = () => {
    void status.refetch()
    void queryClient.invalidateQueries({ queryKey: qk.settings })
    void queryClient.invalidateQueries({ queryKey: qk.factors })
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading>Overview</PageHeading>
        <Button onClick={refresh} busy={status.isFetching}>
          Refresh
        </Button>
      </div>
      {status.isError ? (
        <Callout tone="warn" title="Limited mode">
          <p className="m-0">
            owner-admin isn't answering, so status figures and account management are unavailable. Kill switches,
            hiding posts and notices still work.
          </p>
        </Callout>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <MaintenanceCard status={status} now={now} />
        <KillSwitches />
        <StorageCard status={status} />
        <ContentCard status={status} />
        <DevicesCard />
        <Card as="section" labelledBy={weeklyId} className="flex flex-col gap-2">
          <h2 id={weeklyId} className="m-0 text-base font-semibold">
            Weekly check
          </h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>Supabase → Usage: egress (5 GB), storage (1 GB), function calls (500k). Over quota means one grace period, then HTTP 402 everywhere.</li>
            <li>Cloudflare → Workers: usmfomo-cron runs every hour without errors.</li>
            <li>Accounts: any 2FA device added recently that a club didn't expect?</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
