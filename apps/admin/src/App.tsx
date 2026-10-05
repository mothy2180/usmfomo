import { ChallengePage } from './auth/ChallengePage.tsx'
import { EnrolPage } from './auth/EnrolPage.tsx'
import { CheckingPage, NotOwnerPage, StatusErrorPage } from './auth/GatePages.tsx'
import { IdleGuard } from './auth/IdleGuard.tsx'
import { SecondDevicePage } from './auth/SecondDevicePage.tsx'
import { SignInPage } from './auth/SignInPage.tsx'
import { Console } from './console/Console.tsx'
import { useSession, type Phase } from './lib/sessionContext.ts'

/** One screen per sign-in phase; the console itself only once the owner is confirmed at aal2. */
export function App() {
  const { phase } = useSession()
  return (
    <>
      <Screen phase={phase} />
      <IdleGuard />
    </>
  )
}

function Screen({ phase }: { phase: Phase }) {
  switch (phase.kind) {
    case 'signed_out':
      return <SignInPage notice={phase.notice} />
    case 'not_owner':
      return <NotOwnerPage />
    case 'enrol':
      return <EnrolPage />
    case 'challenge':
      return <ChallengePage factors={phase.factors} />
    case 'checking':
      return <CheckingPage />
    case 'status_error':
      return <StatusErrorPage error={phase.error} ownerHint={phase.ownerHint} />
    case 'second_device':
      return <SecondDevicePage />
    case 'ready':
      return <Console />
  }
}
