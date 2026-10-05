import { useId } from 'react'
import { CopyButton } from './CopyButton.tsx'
import { Button, Callout } from './ui.tsx'

type Props = {
  username: string
  password: string
  /** What just happened, e.g. "Account created." */
  lead?: string
  /** The parent must drop the password from its state here. */
  onDone: () => void
}

/**
 * Shows a generated password exactly once. The password is never stored by
 * the console or the server, so it is gone once the owner presses Done (the
 * parent clears it from state) or signs out.
 */
export function ShowOncePassword({ username, password, lead, onDone }: Props) {
  const id = useId()
  return (
    <div className="flex flex-col gap-4">
      {lead ? <p className="m-0 text-sm">{lead}</p> : null}
      <Callout tone="warn" title="Copy this password now. It is shown only once.">
        <p className="m-0">
          It isn't stored anywhere and can't be shown again. Send it to the club or school through their official
          channel, never in a public post. If it gets lost, reset the password.
        </p>
      </Callout>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Username</dt>
        <dd className="m-0 break-all font-mono">{username}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-semibold">
          Password for {username}
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <input
            id={id}
            readOnly
            value={password}
            onFocus={(e) => e.currentTarget.select()}
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 min-w-0 flex-1 basis-56 rounded-lg border border-accent/70 bg-ink px-3 py-2 font-mono text-base tracking-wide text-text"
          />
          <CopyButton text={password} label="Copy password" />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p id={`${id}-done`} className="m-0 text-xs text-muted">
          Done removes the password from this page.
        </p>
        <Button variant="primary" onClick={onDone} aria-describedby={`${id}-done`}>
          Done
        </Button>
      </div>
    </div>
  )
}
