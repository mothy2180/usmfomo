import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Callout, ErrorState, Spinner } from '../components/ui.tsx'
import { formatMytDateTime } from '../lib/format.ts'
import { errorMessage } from '../lib/messages.ts'
import { qk, useFactors } from '../lib/queries.ts'
import { useSession } from '../lib/sessionContext.ts'
import { AuthLayout } from './AuthLayout.tsx'
import { EnrolFactor } from './EnrolFactor.tsx'

/** The owner needs two TOTP devices before the console opens (the approved
 * plan), so losing one phone never locks the owner out. There is no skip. */
export function SecondDevicePage() {
  const session = useSession()
  const queryClient = useQueryClient()
  const factors = useFactors()
  const [opening, setOpening] = useState(false)
  const devices = factors.data ?? []

  async function openConsole() {
    setOpening(true)
    try {
      // Checks the devices again with Auth; stays here unless there are two.
      await session.continueToConsole()
    } finally {
      setOpening(false)
    }
  }

  const signOut = (
    <Button variant="ghost" onClick={() => void session.signOut()} className="self-start">
      Sign out
    </Button>
  )

  if (factors.isPending) {
    return (
      <AuthLayout key="add" title="Add a second device">
        <Spinner />
        {signOut}
      </AuthLayout>
    )
  }
  if (factors.isError) {
    return (
      <AuthLayout key="add" title="Add a second device">
        <ErrorState message={errorMessage(factors.error)} onRetry={() => void factors.refetch()} />
        {signOut}
      </AuthLayout>
    )
  }

  if (devices.length >= 2) {
    // A new key: the new heading takes focus once the second device is added.
    return (
      <AuthLayout key="done" title="Two devices enrolled">
        <DeviceList devices={devices} />
        <p className="m-0 text-sm">Either device can now sign you in. Keep the backup somewhere safe.</p>
        <Button variant="primary" busy={opening} onClick={() => void openConsole()} className="self-start">
          Continue to the console
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout key="add" title="Add a second device">
      <p className="m-0 text-sm">
        The console opens once two devices are enrolled. With only one, losing it locks you out until you run the
        break-glass command <code className="font-mono">pnpm account owner-reset-mfa</code> with the owner-cli secret key.
      </p>
      <Callout tone="info" title="Any authenticator app works">
        <p className="m-0">
          The second device can be any TOTP app: a second phone, a tablet, or a password manager such as 1Password or
          Bitwarden. Pick one you won't lose together with the first device.
        </p>
      </Callout>
      {devices.length ? <DeviceList devices={devices} /> : null}
      <EnrolFactor
        defaultName="Backup device"
        existingNames={devices.map((d) => d.name)}
        onVerified={() => queryClient.invalidateQueries({ queryKey: qk.factors })}
      />
      {signOut}
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
