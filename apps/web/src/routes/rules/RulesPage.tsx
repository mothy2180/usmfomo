import { LIMITS, POSTER } from '@usmfomo/shared/config'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AppShell } from '../../components/AppShell.tsx'
import { CONTACT_URL } from '../../env.ts'
import { contactHref as toContactHref } from '../../features/public/contact.ts'
import { useDocumentTitle } from '../../features/public/hooks.ts'

// Numbers come from the shared config (which mirrors the database), so the
// page can't drift from what Postgres enforces.
const LIMIT_VALUES = {
  live: LIMITS.livePosts,
  daily: LIMITS.newPostsPer24h,
  edits: LIMITS.editsPer24h,
  days: LIMITS.maxEventDays,
  mb: Math.round(POSTER.maxInputBytes / (1024 * 1024)),
}

const LIST_SECTIONS = ['who', 'allowed', 'notAllowed', 'limits', 'posters', 'security'] as const

/** Owner-configured contact link (build time); only https: or mailto:. */
const contactHref = toContactHref(CONTACT_URL)

/** "message the usmfomo admin": a link once the owner has set CONTACT_URL. */
function ContactLink({ children }: { children?: ReactNode }) {
  return contactHref ? (
    <a href={contactHref} target="_blank" rel="noopener noreferrer" className="text-sky underline underline-offset-2">
      {children}
    </a>
  ) : (
    <strong>{children}</strong>
  )
}

/** /rules — what clubs and schools may post, the limits, and how to get help. */
export function RulesPage() {
  const { t } = useTranslation('dashboard')
  useDocumentTitle(t('rules.docTitle'))

  const items = (key: string): string[] => {
    const value: unknown = t(key, { returnObjects: true, ...LIMIT_VALUES })
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  }

  return (
    <AppShell>
      <article className="flex flex-col gap-8">
        <header>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight">{t('rules.title')}</h1>
          <p className="m-0 mt-2 text-muted">{t('rules.intro')}</p>
        </header>

        {LIST_SECTIONS.map((key) => (
          <section key={key} aria-labelledby={`rules-${key}`}>
            <h2 id={`rules-${key}`} className="m-0 text-xl font-bold">
              {t(`rules.${key}.title`)}
            </h2>
            <ul className="m-0 mt-3 flex list-disc flex-col gap-2 pl-5 leading-relaxed marker:text-muted">
              {items(`rules.${key}.items`).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
        ))}

        <section aria-labelledby="rules-moderation">
          <h2 id="rules-moderation" className="m-0 text-xl font-bold">
            {t('rules.moderation.title')}
          </h2>
          <p className="m-0 mt-3 leading-relaxed">{t('rules.moderation.body')}</p>
        </section>

        <section aria-labelledby="rules-account">
          <h2 id="rules-account" className="m-0 text-xl font-bold">
            {t('rules.account.title')}
          </h2>
          <p className="m-0 mt-3 leading-relaxed">
            <Trans t={t} i18nKey="rules.account.body" components={{ contact: <ContactLink /> }} />
          </p>
        </section>

        <section aria-labelledby="rules-disclaimer" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="rules-disclaimer" className="m-0 text-base font-bold">
            {t('rules.disclaimer.title')}
          </h2>
          <p className="m-0 mt-2 text-sm leading-relaxed text-muted">{t('rules.disclaimer.body')}</p>
        </section>
      </article>
    </AppShell>
  )
}
