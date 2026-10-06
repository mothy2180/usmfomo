import type { ReactNode } from 'react'
import { Button } from '../components/ui.tsx'
import { cx } from '../lib/cx.ts'
import { useSession } from '../lib/sessionContext.ts'
import { SECTIONS, type SectionId } from './sections.ts'

export function ConsoleLayout({ section, children }: { section: SectionId; children: ReactNode }) {
  const session = useSession()
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-accent px-3 py-2 text-accent-ink">
        Skip to content
      </a>
      {/* Sticky only where it fits on one row: on narrow or zoomed screens a
          tall sticky header could hide the focused element (WCAG 2.4.11). */}
      <header className="border-b border-line bg-ink/95 lg:sticky lg:top-0 lg:z-40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
          <p className="m-0 text-lg font-extrabold tracking-tight">
            usmfomo <span className="font-semibold text-muted">owner</span>
          </p>
          <nav aria-label="Console sections" className="order-3 w-full sm:order-none sm:w-auto">
            <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={section === s.id ? 'page' : undefined}
                    className={cx(
                      'inline-flex min-h-11 items-center rounded-lg px-3 text-sm no-underline',
                      section === s.id ? 'bg-surface-2 font-semibold text-text' : 'text-muted hover:text-text',
                    )}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            {session.username ? (
              <span className="hidden text-muted md:inline">
                Signed in as <span className="font-semibold text-text">{session.username}</span>
              </span>
            ) : null}
            <Button onClick={() => void session.signOut()}>Sign out</Button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-line px-4 py-4 text-xs text-muted">
        <p className="m-0 mx-auto max-w-6xl">
          Sign-out ends every owner session (in limited mode, only this one) and is automatic after 30 minutes without
          activity. All times are Malaysia time (MYT).
        </p>
      </footer>
    </div>
  )
}
