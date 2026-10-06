import { Button, Callout, Spinner } from '../components/ui.tsx'
import { PUBLIC_SITE_URL } from '../env.ts'
import { errorMessage } from '../lib/messages.ts'
import { useSession } from '../lib/sessionContext.ts'
import { publicLoginUrl } from '../lib/siteUrl.ts'
import { AuthLayout } from './AuthLayout.tsx'

export function CheckingPage() {
  return (
    <AuthLayout title="Checking owner access">
      <Spinner label="Asking the server whether this is the owner account…" />
    </AuthLayout>
  )
}

export function NotOwnerPage() {
  const session = useSession()
  return (
    <AuthLayout title="This account is not the owner">
      <p className="m-0 text-sm" role="alert">
        Only the usmfomo owner account can use this console, so you have been signed out here.
      </p>
      <p className="m-0 text-sm">
        Club and school accounts sign in at{' '}
        <a href={publicLoginUrl(PUBLIC_SITE_URL)} className="text-sky underline">
          {publicLoginUrl(PUBLIC_SITE_URL).replace(/^https?:\/\//, '')}
        </a>
        .
      </p>
      <Button onClick={session.backToSignIn} className="self-start">
        Back to sign-in
      </Button>
    </AuthLayout>
  )
}

/** owner-admin could not confirm the owner (network, function down, …). */
export function StatusErrorPage({ error, ownerHint }: { error: unknown; ownerHint: boolean }) {
  const session = useSession()
  return (
    <AuthLayout title="Couldn't confirm owner access">
      <p className="m-0 text-sm" role="alert">
        {errorMessage(error)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void session.retryStatus()}>
          Try again
        </Button>
        <Button variant="ghost" onClick={() => void session.signOut()}>
          Sign out
        </Button>
      </div>
      {ownerHint ? (
        <Callout tone="warn" title="Limited mode">
          <p className="m-0">
            You can still open the console: the kill switches, hiding posts and notices talk to the database directly, and
            the database checks that you are the owner on every change. Account management, deleting posts and the
            status figures need owner-admin. Signing out then ends only this session.
          </p>
          <Button onClick={() => void session.continueLimited()} className="self-start">
            Continue in limited mode
          </Button>
        </Callout>
      ) : null}
    </AuthLayout>
  )
}
