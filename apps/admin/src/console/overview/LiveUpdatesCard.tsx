import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { Card, ErrorState, FormError, RadioGroup, Spinner } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { errorMessage } from '../../lib/messages.ts'
import { POLL_CHOICES, qk, setPollSeconds, useLiveState, type PollSeconds } from '../../lib/queries.ts'

const LABELS: Record<PollSeconds, { label: string; hint: string }> = {
  0: { label: 'Off', hint: 'Pages update only when reloaded or refocused.' },
  30: { label: 'Every 30 seconds', hint: 'Default. About 0.5 GB of egress a month at 3,000 visits a day.' },
  60: { label: 'Every minute', hint: 'About 0.3 GB a month.' },
  120: { label: 'Every 2 minutes', hint: 'Use when Usage shows egress over 3.5 GB mid-month.' },
  300: { label: 'Every 5 minutes', hint: 'Lowest egress short of turning it off.' },
}

export function LiveUpdatesCard() {
  const titleId = useId()
  const live = useLiveState()
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const mutation = useMutation({
    mutationFn: setPollSeconds,
    onSuccess: (row) => {
      queryClient.setQueryData(qk.live, row)
      announce('Live update interval saved.')
    },
  })
  const current = live.data?.poll_seconds
  return (
    <Card as="section" labelledBy={titleId} className="flex flex-col gap-3">
      <div>
        <h2 id={titleId} className="m-0 text-base font-semibold">
          Live updates
        </h2>
        <p className="m-0 text-xs text-muted">
          How often open pages check for new or changed posts. They reload only when something changed; hidden and idle
          tabs don't check. Open pages pick up a new setting on their next check.
        </p>
      </div>
      {live.isPending ? <Spinner /> : null}
      {live.isError ? <ErrorState message={errorMessage(live.error)} onRetry={() => void live.refetch()} /> : null}
      {current !== undefined ? (
        <RadioGroup
          legend="Check interval"
          name="poll-seconds"
          value={String(current)}
          options={POLL_CHOICES.map((s) => ({ value: String(s), ...LABELS[s] }))}
          onChange={(v) => mutation.mutate(Number(v) as PollSeconds)}
          disabled={mutation.isPending}
        />
      ) : null}
      <FormError message={mutation.isError ? errorMessage(mutation.error) : null} />
    </Card>
  )
}
