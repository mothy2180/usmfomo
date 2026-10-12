import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CONTACT_URL } from '../env.ts'
import { CREATOR_URL, FEEDBACK_URL } from '../lib/credit.ts'
import { useLiveUpdates } from '../lib/live.ts'
import { LanguageSwitch } from './LanguageSwitch.tsx'

export function SiteFooter() {
  const { t } = useTranslation()
  return (
    <footer className="mt-12 border-t border-line px-4 py-6 text-xs text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:justify-between sm:gap-8">
        <div className="flex flex-col gap-3">
          <p className="m-0 max-w-3xl">{t('footer.disclaimer')}</p>
          <nav aria-label={t('footer.label')} className="flex flex-wrap gap-x-4 gap-y-2">
            <Link to="/rules" className="underline">
              {t('footer.rules')}
            </Link>
          </nav>
          <p className="m-0">
            <Trans
              t={t}
              i18nKey="footer.createdBy"
              components={{
                creator: CREATOR_URL.startsWith('https://') ? (
                  <a href={CREATOR_URL} target="_blank" rel="noopener noreferrer" className="underline" />
                ) : (
                  <span />
                ),
              }}
            />
          </p>
        </div>
        {/* Feedback, and the contact channel under it, on the right from sm. */}
        <nav aria-label={t('footer.helpLabel')} className="flex shrink-0 flex-col gap-2 sm:items-end">
          <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="underline">
            {t('footer.feedback')}
          </a>
          {CONTACT_URL ? (
            <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="underline">
              {t('footer.contact')}
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  )
}

/** Keeps the page's lists live; says so while it has paused for inactivity
 * (any input resumes it, the button only makes that obvious). */
function LiveStatus() {
  const { t } = useTranslation()
  const { paused } = useLiveUpdates()
  return (
    <div role="status" className={paused ? 'mx-auto mt-3 flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 text-sm text-muted' : 'sr-only'}>
      {paused ? (
        <>
          <span>{t('live.paused')}</span>
          <button type="button" className="underline">
            {t('live.resume')}
          </button>
        </>
      ) : null}
    </div>
  )
}

/** Layout for every page except the landing page. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-accent px-3 py-2 text-accent-ink">
        {t('skipToContent')}
      </a>
      {/* Sticky only where it fits on one row: on narrow or zoomed screens a
          tall sticky header could hide the focused element (WCAG 2.4.11).
          styles.css keeps scrolled-to elements clear of it from lg. */}
      <header className="border-b border-line bg-ink/95 backdrop-blur lg:sticky lg:top-0 lg:z-40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          {/* The landing page is a different HTML document: use a plain link. */}
          <a href="/" className="text-lg font-extrabold tracking-tight text-text no-underline">
            usmfomo
          </a>
          <nav aria-label={t('nav.label')} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
            <Link to="/dashboard" className="text-muted hover:text-text [&.active]:text-text">
              {t('nav.dashboard')}
            </Link>
            <Link to="/login" className="text-muted hover:text-text [&.active]:text-text">
              {t('nav.login')}
            </Link>
            <LanguageSwitch />
          </nav>
        </div>
      </header>
      <LiveStatus />
      <main id="main" className={wide ? 'mx-auto w-full max-w-6xl flex-1 px-4 py-6' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-6'}>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
