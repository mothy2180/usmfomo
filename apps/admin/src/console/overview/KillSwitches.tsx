import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { Badge, Button, Card, ErrorState, Spinner } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { formatMytDateTime } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { qk, setSwitch, useSettings, type SwitchName } from '../../lib/queries.ts'

type Copy = {
  state: string
  action: string
  confirmTitle: string
  effect: string[]
  confirmLabel: string
  tone: 'danger' | 'primary'
  done: string
}

const COPY: Record<SwitchName, { title: string; on: Copy; off: Copy }> = {
  posting_enabled: {
    title: 'Posting',
    on: {
      state: 'On: clubs and schools can post and edit.',
      action: 'Pause posting',
      confirmTitle: 'Pause all posting?',
      effect: [
        'No club or school can create or edit a post, or upload a poster, until you resume posting.',
        'Posts already up stay visible to the public. You can still moderate.',
      ],
      confirmLabel: 'Pause posting',
      tone: 'danger',
      done: 'Posting paused.',
    },
    off: {
      state: 'Paused: nobody can post, edit or upload.',
      action: 'Resume posting',
      confirmTitle: 'Resume posting?',
      effect: ['Clubs and schools can create and edit posts and upload posters again, within their usual limits.'],
      confirmLabel: 'Resume posting',
      tone: 'primary',
      done: 'Posting resumed.',
    },
  },
  public_reads_enabled: {
    title: 'Public site content',
    on: {
      state: 'On: the public sees posts, notices and organisations.',
      action: 'Hide everything from the public',
      confirmTitle: 'Hide everything from the public?',
      effect: [
        'Degraded mode: the public site shows no posts, notices or organisations until you turn this back on.',
        'Use it during a quota attack (see the runbook) to cut database egress. Clubs and schools can still sign in and see their own posts.',
      ],
      confirmLabel: 'Hide everything',
      tone: 'danger',
      done: 'Public content hidden (degraded mode).',
    },
    off: {
      state: 'Off: degraded mode, the public sees no content.',
      action: 'Show content again',
      confirmTitle: 'Show content to the public again?',
      effect: ['Posts, notices and organisations become visible on the public site again.'],
      confirmLabel: 'Show content',
      tone: 'primary',
      done: 'Public content visible again.',
    },
  },
}

export function KillSwitches() {
  const titleId = useId()
  const settings = useSettings()
  return (
    <Card as="section" labelledBy={titleId} className="flex flex-col gap-4">
      <div>
        <h2 id={titleId} className="m-0 text-base font-semibold">
          Kill switches
        </h2>
        <p className="m-0 text-xs text-muted">Saved straight to the database; they work even when owner-admin is down.</p>
      </div>
      {settings.isPending ? <Spinner /> : null}
      {settings.isError ? <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} /> : null}
      {settings.data ? (
        <>
          <Switch name="posting_enabled" value={settings.data.posting_enabled} />
          <Switch name="public_reads_enabled" value={settings.data.public_reads_enabled} />
          <p className="m-0 text-xs text-muted">Last changed {formatMytDateTime(settings.data.updated_at)}</p>
        </>
      ) : null}
    </Card>
  )
}

function Switch({ name, value }: { name: SwitchName; value: boolean }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const [confirming, setConfirming] = useState(false)
  const copy = value ? COPY[name].on : COPY[name].off
  const mutation = useMutation({
    mutationFn: () => setSwitch(name, !value),
    onSuccess: (row) => {
      queryClient.setQueryData(qk.settings, row)
      void queryClient.invalidateQueries({ queryKey: qk.status })
      setConfirming(false)
      announce(copy.done)
    },
  })
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold">{COPY[name].title}</h3>
        {value ? <Badge tone="ok">On</Badge> : <Badge tone="danger">Off</Badge>}
      </div>
      <p className="m-0 text-sm">{copy.state}</p>
      <Button
        variant={copy.tone === 'danger' ? 'danger' : 'primary'}
        onClick={() => {
          mutation.reset()
          setConfirming(true)
        }}
        className="self-start"
      >
        {copy.action}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={copy.confirmTitle}
        confirmLabel={copy.confirmLabel}
        tone={copy.tone}
        busy={mutation.isPending}
        error={mutation.isError ? errorMessage(mutation.error) : null}
        onConfirm={() => mutation.mutate()}
        onClose={() => setConfirming(false)}
      >
        {copy.effect.map((line) => (
          <p key={line} className="m-0">
            {line}
          </p>
        ))}
      </ConfirmDialog>
    </div>
  )
}
