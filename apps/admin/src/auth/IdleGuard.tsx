import { Dialog } from '../components/Dialog.tsx'
import { Button } from '../components/ui.tsx'
import { formatCountdown, useIdleTimeout } from '../lib/idle.ts'
import { NOTICES, hasSession, useSession } from '../lib/sessionContext.ts'

/** Signs out after 30 minutes without input, with a two-minute warning that
 * one click dismisses. session.signOut picks the scope: global only once
 * owner-admin has confirmed the owner, otherwise just this session. */
export function IdleGuard() {
  const session = useSession()
  const { state, stayActive } = useIdleTimeout({
    enabled: hasSession(session.phase),
    onExpire: () => void session.signOut(NOTICES.idle),
  })
  const warning = state.phase === 'warning'
  return (
    <Dialog open={warning} title="Still there?" onClose={stayActive}>
      <p className="m-0 text-sm">
        For safety you will be signed out in{' '}
        <span className="font-mono font-semibold">{warning ? formatCountdown(state.remainingMs) : ''}</span> because
        there has been no activity for a while.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => void session.signOut()}>
          Sign out now
        </Button>
        <Button variant="primary" onClick={stayActive} data-autofocus>
          Stay signed in
        </Button>
      </div>
    </Dialog>
  )
}
