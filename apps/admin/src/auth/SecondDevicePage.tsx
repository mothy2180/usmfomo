import { useQueryClient } from '@tanstack/react-query'
import { Button, Callout, ErrorState, Spinner } from '../components/ui.tsx'
import { formatMytDateTime } from '../lib/format.ts'
import { errorMessage } from '../lib/messages.ts'
import { qk, useFactors } from '../lib/queries.ts'
import { useSession } from '../lib/sessionContext.ts'
import { AuthLayout } from './AuthLayout.tsx'
import { EnrolFactor } from './EnrolFactor.tsx'

/** Strong prompt for a backup device while only one is enrolled. */
export function SecondDevicePage() {
  const session = useSession()
  const queryClient = useQueryClient()
  const factors = useFactors()
  const devices = factors.data ?? []

  if (factors.isPending) {
    return (
      <AuthLayout title="Add a second device">
        <Spinner />
      </AuthLayout>
    )
  }
  if (factors.isError) {
    return (
      <AuthLayout title="Add a second device">
        <ErrorState message={errorMessage(factors.error)} onRetry={() => void factors.refetch()} />
        <Button onClick={session.continueToConsole} className="self-start">
          Continue to the console
        </Button>
      </AuthLayout>
    )
  }

  if (devices.length >= 2) {
    return (
      <AuthLayout title="Two devices enrolled">
        <DeviceList devices={devices} />
        <p className="m-0 text-sm">Either device can now sign you in. Keep the backup somewhere safe.</p>
        <Button variant="primary" onClick={session.continueToConsole} className="self-start">
          Continue to the console
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Add a second device">
      <Callout tone="warn" title="Only one device is enrolled">
        <p className="m-0">
          If you lose it, you are locked out of the owner console. Getting back in then needs the break-glass command{' '}
          <code className="font-mono">pnpm account owner-reset-mfa</code> with the owner-cli secret key.
        </p>
      </Callout>
      <DeviceList devices={devices} />
      <EnrolFactor
        defaultName="Backup device"
        existingNames={devices.map((d) => d.name)}
        onVerified={() => queryClient.invalidateQueries({ queryKey: qk.factors })}
      />
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="m-0 text-sm text-muted">Not now? You will be asked again at the next sign-in.</p>
        <Button variant="danger" onClick={session.continueToConsole} className="self-start">
          Continue with one device (not recommended)
        </Button>
      </div>
    </AuthLayout>
  )
}

function DeviceList({ devices }: { devices: ReadonlyArray<{ id: string; name: string; createdAt: string }> }) {
  return (
    <div>
      <h2 className="m-0 mb-2 text-base font-semibold">Enrolled devices</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {devices.map((d) => (
          <li key={d.id} className="rounded-lg border border-line bg-surface px-3 py-2">
            <span className="font-semibold">{d.name}</span>{' '}
            <span className="text-muted">· added {formatMytDateTime(d.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
