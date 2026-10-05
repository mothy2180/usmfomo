import { useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { ConfirmBody } from '../../components/ConfirmDialog.tsx'
import { Dialog } from '../../components/Dialog.tsx'
import { ShowOncePassword } from '../../components/ShowOncePassword.tsx'
import { Badge, Button } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import type { AccountRow } from '../../lib/api.ts'
import { adminApi } from '../../lib/db.ts'
import { formatAge, formatMytDateTime, plural } from '../../lib/format.ts'
import { CAMPUS_LABELS, TYPE_LABELS } from '../../lib/labels.ts'
import { errorMessage } from '../../lib/messages.ts'
import { qk } from '../../lib/queries.ts'
import { reportSessionProblem } from '../../lib/sessionEvents.ts'
import { useNow } from '../../lib/useNow.ts'
import { hasRecentFactor } from './accountForms.ts'
import { EditOrgForm } from './EditOrgForm.tsx'

type ActionKind = 'reset' | 'handover' | 'pause' | 'resume' | 'factors' | 'delete'

type Step =
  | { kind: 'menu' }
  | { kind: 'confirm'; action: ActionKind }
  | { kind: 'edit' }
  | { kind: 'password'; password: string; lead: string }

type ActionCopy = {
  label: string
  /** One line under the button in the menu. */
  summary: string
  title: string
  effect: ReactNode
  confirmLabel: string
  tone: 'danger' | 'primary'
}

function actionCopy(action: ActionKind, a: AccountRow): ActionCopy {
  const org = a.org_name ?? a.username
  switch (action) {
    case 'reset':
      return {
        label: 'Reset password',
        summary: 'New random password; signs them out everywhere. Their 2FA devices stay.',
        title: `Reset the password of ${a.username}?`,
        effect: (
          <>
            <p className="m-0">A new random password is generated and shown to you once.</p>
            <p className="m-0">Every session of {a.username} ends at once, on every device. Their 2FA devices stay enrolled.</p>
          </>
        ),
        confirmLabel: 'Reset password',
        tone: 'danger',
      }
    case 'handover':
      return {
        label: 'Hand over to a new committee',
        summary: 'New password, all 2FA devices removed, every session ended. Posts stay.',
        title: `Hand over ${a.username} to a new committee?`,
        effect: (
          <>
            <p className="m-0">
              In one step: the account is paused, gets a new random password (which ends every session), loses all of its
              2FA devices, and is then active again.
            </p>
            <p className="m-0">
              Give the new password only to the new committee, through {org}’s official channel. They can enrol their own
              2FA devices. Posts stay up.
            </p>
          </>
        ),
        confirmLabel: 'Hand over',
        tone: 'danger',
      }
    case 'pause':
      return {
        label: 'Pause account',
        summary: 'Blocks sign-in and posting at once. Their posts stay public.',
        title: `Pause ${a.username}?`,
        effect: (
          <>
            <p className="m-0">
              They can’t sign in, and sessions that are still open can no longer create, edit or delete posts or upload
              posters. You can resume the account at any time.
            </p>
            <p className="m-0">
              Their posts stay public. To hide {org} and its posts as well, edit the organisation and untick Active.
            </p>
          </>
        ),
        confirmLabel: 'Pause account',
        tone: 'danger',
      }
    case 'resume':
      return {
        label: 'Resume account',
        summary: 'They can sign in and post again with their current password.',
        title: `Resume ${a.username}?`,
        effect: <p className="m-0">They can sign in and post again with their current password and 2FA devices.</p>,
        confirmLabel: 'Resume account',
        tone: 'primary',
      }
    case 'factors':
      return {
        label: 'Remove 2FA devices',
        summary: 'For a lost phone: they sign in with the password alone and enrol again.',
        title: `Remove all 2FA devices of ${a.username}?`,
        effect: (
          <>
            <p className="m-0">
              {plural(a.factor_count, 'device')} will be removed. They can then sign in with the password alone and enrol
              new devices in Studio settings.
            </p>
            <p className="m-0">
              Sessions that are already signed in stay signed in. If someone else may know the password, use Hand over
              instead: it also changes the password and ends every session.
            </p>
          </>
        ),
        confirmLabel: 'Remove devices',
        tone: 'danger',
      }
    case 'delete':
      return {
        label: 'Delete account',
        summary: 'Deletes the account, the organisation, its posts and poster files. Can’t be undone.',
        title: `Delete ${a.username} permanently?`,
        effect: (
          <>
            <p className="m-0">
              This deletes the account, the organisation “{org}”, {plural(a.live_posts, 'live post')} (and any ended ones
              not yet cleaned up) and all of its poster files. Signing in stops working at once.
            </p>
            <p className="m-0">
              There is no undo. To bring them back later, create a new account. Copies of posters already cached may stay
              reachable for up to 6 hours.
            </p>
          </>
        ),
        confirmLabel: 'Delete account',
        tone: 'danger',
      }
  }
}

function menuActions(a: AccountRow): ActionKind[] {
  return ['reset', 'handover', a.account_active ? 'pause' : 'resume', 'factors', 'delete']
}

/** Manage one club/school account. Every action explains itself and asks for
 * confirmation; generated passwords are shown once and dropped on Done. */
export function AccountDialog({
  account,
  accounts,
  onClose,
}: {
  account: AccountRow
  accounts: readonly AccountRow[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [step, setStepState] = useState<Step>({ kind: 'menu' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setStep = (next: Step) => {
    setError(null)
    setStepState(next)
  }

  const refresh = (alsoPosts = false) => {
    void queryClient.invalidateQueries({ queryKey: qk.accounts })
    void queryClient.invalidateQueries({ queryKey: qk.status })
    if (alsoPosts) void queryClient.invalidateQueries({ queryKey: qk.posts })
  }

  const finish = (message: string) => {
    onClose()
    announce(message)
  }

  async function run(action: ActionKind) {
    if (busy) return
    setBusy(true)
    setError(null)
    const id = account.user_id
    try {
      switch (action) {
        case 'reset': {
          const { password } = await adminApi.resetPassword(id)
          refresh()
          setStepState({ kind: 'password', password, lead: `Password reset. Every session of ${account.username} has ended.` })
          break
        }
        case 'handover': {
          const { password } = await adminApi.handover(id)
          refresh()
          setStepState({
            kind: 'password',
            password,
            lead: `Handover done: new password, all 2FA devices removed, every session of ${account.username} ended.`,
          })
          break
        }
        case 'pause':
        case 'resume':
          await adminApi.setAccountActive(id, action === 'resume')
          refresh()
          finish(action === 'resume' ? `${account.username} resumed.` : `${account.username} paused.`)
          break
        case 'factors': {
          const removed = await adminApi.removeFactors(id)
          refresh()
          finish(
            removed === null
              ? `2FA devices of ${account.username} removed.`
              : `Removed ${plural(removed, '2FA device')} from ${account.username}.`,
          )
          break
        }
        case 'delete': {
          const files = await adminApi.deleteAccount(id)
          refresh(true)
          finish(files ? `${account.username} deleted, with ${plural(files, 'poster file')}.` : `${account.username} deleted.`)
          break
        }
      }
    } catch (err) {
      reportSessionProblem(err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function done() {
    // Drop the password from state before the dialog goes away.
    setStepState({ kind: 'menu' })
    onClose()
  }

  const locked = busy || step.kind === 'password'

  let title: string
  let body: ReactNode
  switch (step.kind) {
    case 'menu':
      title = `Manage ${account.username}`
      body = <Menu account={account} onPick={setStep} onClose={onClose} />
      break
    case 'confirm': {
      const copy = actionCopy(step.action, account)
      title = copy.title
      body = (
        <ConfirmBody
          key={step.action}
          confirmLabel={copy.confirmLabel}
          tone={copy.tone}
          busy={busy}
          error={error}
          confirmText={step.action === 'delete' ? account.username : undefined}
          onConfirm={() => void run(step.action)}
          onCancel={() => setStep({ kind: 'menu' })}
          cancelLabel="Back"
        >
          {copy.effect}
        </ConfirmBody>
      )
      break
    }
    case 'edit':
      title = `Edit ${account.org_name ?? 'organisation'}`
      body = (
        <EditOrgForm
          account={account}
          accounts={accounts}
          onBusy={setBusy}
          onCancel={() => setStep({ kind: 'menu' })}
          onSaved={() => {
            refresh(true)
            finish('Organisation saved.')
          }}
        />
      )
      break
    case 'password':
      title = 'New password'
      body = <ShowOncePassword username={account.username} password={step.password} lead={step.lead} onDone={done} />
      break
  }

  const focusKey = step.kind === 'confirm' ? `confirm-${step.action}` : step.kind
  return (
    <Dialog open title={title} onClose={onClose} focusKey={focusKey} preventEscape={locked}>
      {body}
    </Dialog>
  )
}

function Menu({ account: a, onPick, onClose }: { account: AccountRow; onPick: (step: Step) => void; onClose: () => void }) {
  const now = useNow(60_000)
  const baseId = useId()
  const recent = hasRecentFactor(a, now)
  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Organisation</dt>
        <dd className="m-0 min-w-0 break-words">
          {a.org_name ?? '—'} <span className="break-all font-mono text-xs text-muted">/o/{a.org_slug}</span>
        </dd>
        <dt className="text-muted">Type, campus</dt>
        <dd className="m-0">
          {a.org_type ? TYPE_LABELS[a.org_type] : '—'}, {a.org_campus ? CAMPUS_LABELS[a.org_campus] : '—'}
        </dd>
        <dt className="text-muted">Status</dt>
        <dd className="m-0 flex flex-wrap gap-1">
          {a.account_active ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Paused</Badge>}
          {a.org_active === false ? <Badge tone="danger">Org inactive</Badge> : null}
        </dd>
        <dt className="text-muted">2FA devices</dt>
        <dd className="m-0">
          {a.factor_count ? `${plural(a.factor_count, 'device')}, newest ${formatMytDateTime(a.newest_factor_at)}` : 'None'}
          {recent ? (
            <>
              {' '}
              <Badge tone="accent">Added in the last 7 days</Badge>
            </>
          ) : null}
        </dd>
        <dt className="text-muted">Last sign-in</dt>
        <dd className="m-0">{a.last_sign_in_at ? `${formatAge(a.last_sign_in_at, now)} (${formatMytDateTime(a.last_sign_in_at)})` : 'Never'}</dd>
        <dt className="text-muted">Live posts</dt>
        <dd className="m-0">{a.live_posts}</dd>
      </dl>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        <li className="flex flex-col gap-1">
          <Button onClick={() => onPick({ kind: 'edit' })} aria-describedby={`${baseId}-edit`} className="self-start">
            Edit organisation
          </Button>
          <p id={`${baseId}-edit`} className="m-0 text-xs text-muted">
            Name, public link, type, campus, and whether it is active (listed publicly and allowed to post).
          </p>
        </li>
        {menuActions(a).map((action) => {
          const copy = actionCopy(action, a)
          const noDevices = action === 'factors' && a.factor_count === 0
          const descId = `${baseId}-${action}`
          return (
            <li key={action} className="flex flex-col gap-1">
              <Button
                variant={action === 'delete' ? 'danger' : 'secondary'}
                onClick={() => onPick({ kind: 'confirm', action })}
                disabled={noDevices}
                aria-describedby={descId}
                className="self-start"
              >
                {copy.label}
              </Button>
              <p id={descId} className="m-0 text-xs text-muted">
                {noDevices ? 'No 2FA devices are enrolled.' : copy.summary}
              </p>
            </li>
          )
        })}
      </ul>
      <Button onClick={onClose} className="self-end">
        Close
      </Button>
    </div>
  )
}
