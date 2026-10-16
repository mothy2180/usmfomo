import { useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ConfirmBody } from '../../components/ConfirmDialog.tsx'
import { Dialog } from '../../components/Dialog.tsx'
import { PasswordField } from '../../components/PasswordField.tsx'
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
import { validateTypedPassword } from './accountForms.ts'
import { EditOrgForm } from './EditOrgForm.tsx'
import { RenameForm } from './RenameForm.tsx'

type ActionKind = 'reset' | 'handover' | 'pause' | 'resume' | 'delete'

type Step =
  | { kind: 'menu' }
  | { kind: 'confirm'; action: ActionKind }
  | { kind: 'edit' }
  | { kind: 'rename'; draft: string }
  | { kind: 'confirm-rename'; username: string }
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
        summary: 'New password (typed or random); signs them out everywhere.',
        title: `Reset the password of ${a.username}?`,
        effect: (
          <>
            <p className="m-0">The new password, yours or a random one, is shown to you once.</p>
            <p className="m-0">Every session of {a.username} ends at once, on every device.</p>
          </>
        ),
        confirmLabel: 'Reset password',
        tone: 'danger',
      }
    case 'handover':
      return {
        label: 'Hand over to a new committee',
        summary: 'New password, every session ended. Posts stay.',
        title: `Hand over ${a.username} to a new committee?`,
        effect: (
          <>
            <p className="m-0">
              In one step: the account is paused, gets a new password (which ends every session), and is then active
              again.
            </p>
            <p className="m-0">
              Give the new password only to the new committee, through {org}’s official channel. Posts stay up.
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
        effect: <p className="m-0">They can sign in and post again with their current password.</p>,
        confirmLabel: 'Resume account',
        tone: 'primary',
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
  return ['reset', 'handover', a.account_active ? 'pause' : 'resume', 'delete']
}

/** Manage one club/school account. Every action explains itself and asks for
 * confirmation; new passwords are shown once and dropped on Done. */
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
  // A password the owner typed for reset or handover; empty = a random one.
  const [typedPassword, setTypedPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined)
  const passwordId = useId()

  const setStep = (next: Step) => {
    setError(null)
    setPasswordError(undefined)
    setTypedPassword('')
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

  /** The typed password for reset/handover (undefined: a random one), or null after marking the field invalid. */
  function checkedPassword(): string | undefined | null {
    const typed = validateTypedPassword(typedPassword)
    if (typed.ok) return typed.data
    // Commit the error first, so the field is already invalid when it receives focus.
    flushSync(() => setPasswordError(typed.errors.password))
    document.getElementById(passwordId)?.focus()
    return null
  }

  async function run(action: ActionKind) {
    if (busy) return
    const chosen = action === 'reset' || action === 'handover' ? checkedPassword() : undefined
    if (chosen === null) return
    setBusy(true)
    setError(null)
    const id = account.user_id
    try {
      switch (action) {
        case 'reset': {
          const { password } = await adminApi.resetPassword(id, chosen)
          setTypedPassword('')
          refresh()
          setStepState({ kind: 'password', password, lead: `Password reset. Every session of ${account.username} has ended.` })
          break
        }
        case 'handover': {
          const { password } = await adminApi.handover(id, chosen)
          setTypedPassword('')
          refresh()
          setStepState({
            kind: 'password',
            password,
            lead: `Handover done: new password, every session of ${account.username} ended.`,
          })
          break
        }
        case 'pause':
        case 'resume':
          await adminApi.setAccountActive(id, action === 'resume')
          refresh()
          finish(action === 'resume' ? `${account.username} resumed.` : `${account.username} paused.`)
          break
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

  async function rename(username: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    const before = account.username
    try {
      const renamed = await adminApi.renameAccount(account.user_id, username)
      // Show the new name at once; the refetch confirms it.
      queryClient.setQueryData<AccountRow[]>(qk.accounts, (rows) =>
        rows?.map((r) => (r.user_id === account.user_id ? { ...r, username: renamed.username } : r)),
      )
      refresh()
      finish(`${before} is now ${renamed.username}. They sign in with ${renamed.username} from now on.`)
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
      const setsPassword = step.action === 'reset' || step.action === 'handover'
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
          {setsPassword ? (
            <PasswordField
              id={passwordId}
              value={typedPassword}
              onChange={(next) => {
                setTypedPassword(next)
                setPasswordError(undefined)
              }}
              error={passwordError}
              disabled={busy}
            />
          ) : null}
        </ConfirmBody>
      )
      break
    }
    case 'rename':
      title = `Change the username of ${account.username}`
      body = (
        <RenameForm
          account={account}
          accounts={accounts}
          initial={step.draft}
          onCancel={() => setStep({ kind: 'menu' })}
          onNext={(username) => setStep({ kind: 'confirm-rename', username })}
        />
      )
      break
    case 'confirm-rename': {
      const org = account.org_name ?? account.username
      title = `Change ${account.username} to ${step.username}?`
      body = (
        <ConfirmBody
          key="rename"
          confirmLabel="Change username"
          tone="primary"
          busy={busy}
          error={error}
          onConfirm={() => void rename(step.username)}
          onCancel={() => setStep({ kind: 'rename', draft: step.username })}
          cancelLabel="Back"
        >
          <p className="m-0">
            From now on, {org} signs in with <span className="break-all font-mono">{step.username}</span> instead of{' '}
            <span className="break-all font-mono">{account.username}</span>. The password stays the same.
          </p>
          <p className="m-0">
            Sessions that are already signed in keep working. Tell the committee the new username through {org}’s official
            channel, or their next sign-in fails.
          </p>
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
        <li className="flex flex-col gap-1">
          <Button
            onClick={() => onPick({ kind: 'rename', draft: '' })}
            aria-describedby={`${baseId}-rename`}
            className="self-start"
          >
            Change username
          </Button>
          <p id={`${baseId}-rename`} className="m-0 text-xs text-muted">
            A new login name, e.g. after a rebrand. They sign in with it from now on; open sessions keep working.
          </p>
        </li>
        {menuActions(a).map((action) => {
          const copy = actionCopy(action, a)
          const descId = `${baseId}-${action}`
          return (
            <li key={action} className="flex flex-col gap-1">
              <Button
                variant={action === 'delete' ? 'danger' : 'secondary'}
                onClick={() => onPick({ kind: 'confirm', action })}
                aria-describedby={descId}
                className="self-start"
              >
                {copy.label}
              </Button>
              <p id={descId} className="m-0 text-xs text-muted">
                {copy.summary}
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
