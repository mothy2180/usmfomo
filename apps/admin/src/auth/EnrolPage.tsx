import { Button, Callout } from '../components/ui.tsx'
import { useSession } from '../lib/sessionContext.ts'
import { AuthLayout } from './AuthLayout.tsx'
import { EnrolFactor } from './EnrolFactor.tsx'

/** Forced first enrolment: the owner account has no verified TOTP device. */
export function EnrolPage() {
  const session = useSession()
  return (
    <AuthLayout title="Set up two-factor authentication">
      <p className="m-0 text-sm">
        The owner account must use an authenticator app. Nothing else in the console opens until a device is set up.
      </p>
      <Callout tone="info" title="Two devices are required">
        <p className="m-0">
          After this one you add a second device before the console opens, so losing one doesn't lock you out. It can be
          any TOTP app: a second phone, a tablet or a password manager.
        </p>
      </Callout>
      <EnrolFactor defaultName="Phone" existingNames={[]} onVerified={session.mfaVerified} />
      <Button variant="ghost" onClick={() => void session.signOut()} className="self-start">
        Sign out
      </Button>
    </AuthLayout>
  )
}
