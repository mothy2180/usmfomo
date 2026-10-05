import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx.ts'
import { EventCard } from './EventCard.tsx'
import type { Section } from './sections.ts'
import type { PostCard } from './types.ts'

/** Happening now / Today / Tomorrow / This week / Later, each an h3 + list. */
export function PostSections({
  sections,
  now,
  idPrefix,
  layout = 'list',
}: {
  sections: readonly Section<PostCard>[]
  now: Date
  idPrefix: string
  layout?: 'list' | 'grid'
}) {
  const { t } = useTranslation('dashboard')
  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => {
        const headingId = `${idPrefix}-${section.group}`
        return (
          <section key={section.group} aria-labelledby={headingId}>
            <h3 id={headingId} className="m-0 mb-2 text-sm font-bold uppercase tracking-wide text-muted">
              {t(`sections.${section.group}`)}
            </h3>
            <ul className={cx('m-0 list-none p-0', layout === 'grid' ? 'grid gap-3 lg:grid-cols-2' : 'flex flex-col gap-3')}>
              {section.items.map((post) => (
                <li key={post.id} data-post-id={post.id}>
                  <EventCard post={post} now={now} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
