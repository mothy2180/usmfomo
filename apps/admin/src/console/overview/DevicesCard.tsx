import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { EnrolFactor } from '../../auth/EnrolFactor.tsx'
import { Dialog } from '../../components/Dialog.tsx'
import { Badge, Button, Callout, Card, ErrorState, Spinner } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { formatMytDateTime } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { qk, useFactors } from '../../lib/queries.ts'

/** The owner's own TOTP devices, with a way to add a backup later. */
export function DevicesCard() {
  const titleId = useId()
  const factors = useFactors()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [adding, setAdding] = useState(false)
  const devices = factors.data ?? []

  return (
    <Card as="section" labelledBy={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="m-0 text-base font-semibold">
          Your 2FA devices
        </h2>
        {factors.data ? <Badge tone={devices.length >= 2 ? 'ok' : 'danger'}>{devices.length}</Badge> : null}
      </div>
      {factors.isPending ? <Spinner /> : null}
      {factors.isError ? <ErrorState message={errorMessage(factors.error)} onRetry={() => void factors.refetch()} /> : null}
      {factors.data && devices.length < 2 ? (
        <Callout tone="warn" title="Add a backup device">
          <p className="m-0">With a single device, losing it locks you out until you run the break-glass CLI.</p>
        </Callout>
      ) : null}
      {devices.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {devices.map((d) => (
            <li key={d.id}>
              <span className="font-semibold">{d.name}</span> <span className="text-muted">· added {formatMytDateTime(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button onClick={() => setAdding(true)} className="self-start">
        Add a device
      </Button>
      <Dialog open={adding} title="Add a 2FA device" onClose={() => setAdding(false)}>
        <EnrolFactor
          defaultName={devices.length ? 'Backup device' : 'Phone'}
          existingNames={devices.map((d) => d.name)}
          onVerified={async () => {
            await queryClient.invalidateQueries({ queryKey: qk.factors })
            setAdding(false)
            announce('Device added.')
          }}
        />
        <Button onClick={() => setAdding(false)} className="self-end">
          Close
        </Button>
      </Dialog>
    </Card>
  )
}
