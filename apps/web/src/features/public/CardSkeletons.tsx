import { Spinner } from '../../components/ui.tsx'

const bar = 'rounded bg-surface-2 motion-safe:animate-pulse'

/** Placeholder cards while the first page loads (announced once via Spinner). */
export function CardSkeletons({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Spinner small label={label} />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex gap-3 rounded-xl border border-line bg-surface p-3">
          <div className={`size-20 shrink-0 sm:size-24 ${bar}`} />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <div className={`h-4 w-3/4 ${bar}`} />
            <div className={`h-3 w-1/2 ${bar}`} />
            <div className={`h-3 w-2/3 ${bar}`} />
          </div>
        </div>
      ))}
    </div>
  )
}
