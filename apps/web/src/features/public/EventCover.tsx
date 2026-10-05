import type { OrgType } from '@usmfomo/shared/config'
import { cx } from '../../lib/cx.ts'
import { coverFor } from './cover.ts'

/** Stand-in for a missing poster: the organiser's initial on its colour.
 * Decorative only — the card or page already says who organises the event. */
export function EventCover({ org, className, large }: { org: { id: string; name: string; type: OrgType }; className?: string; large?: boolean }) {
  const { initial, tone } = coverFor(org)
  return (
    <div
      aria-hidden="true"
      className={cx(
        'flex select-none items-center justify-center overflow-hidden bg-linear-to-br font-extrabold text-white',
        large ? 'text-7xl' : 'text-3xl',
        tone,
        className,
      )}
    >
      <span className="drop-shadow-md">{initial}</span>
    </div>
  )
}
