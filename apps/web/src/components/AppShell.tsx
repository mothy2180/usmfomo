import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CONTACT_URL } from '../env.ts'
import { LanguageSwitch } from './LanguageSwitch.tsx'

export function SiteFooter() {
  const { t } = useTranslation()
  return (
    <footer className="mt-12 border-t border-line px-4 py-6 text-xs text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <p className="m-0 max-w-3xl">{t('footer.disclaimer')}</p>
        <nav aria-label={t('footer.label')} className="flex flex-wrap gap-x-4 gap-y-2">
          {CONTACT_URL ? (
            <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="underline">
              {t('footer.report')}
            </a>
          ) : null}
          <Link to="/rules" className="underline">
            {t('footer.rules')}
          </Link>
          <a href="https://github.com/mothy2180/usmfomo" target="_blank" rel="noopener noreferrer" className="underline">
            {t('footer.source')}
          </a>
          <a href="/.well-known/security.txt" className="underline">
            {t('footer.security')}
          </a>
        </nav>
      </div>
    </footer>
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
      <main id="main" className={wide ? 'mx-auto w-full max-w-6xl flex-1 px-4 py-6' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-6'}>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
