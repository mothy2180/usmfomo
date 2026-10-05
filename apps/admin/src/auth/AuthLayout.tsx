import type { ReactNode } from 'react'
import { PageHeading } from '../components/PageHeading.tsx'

/** Centred single-column layout for the sign-in steps. */
export function AuthLayout({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line px-4 py-3">
        <p className="m-0 text-lg font-extrabold tracking-tight">
          usmfomo <span className="font-semibold text-muted">owner console</span>
        </p>
      </header>
      <main id="main" tabIndex={-1} className={wide ? 'mx-auto w-full max-w-2xl flex-1 px-4 py-8' : 'mx-auto w-full max-w-md flex-1 px-4 py-8'}>
        <div className="flex flex-col gap-5">
          <PageHeading>{title}</PageHeading>
          {children}
        </div>
      </main>
      <footer className="border-t border-line px-4 py-4 text-xs text-muted">
        <p className="m-0 mx-auto max-w-2xl">
          For the usmfomo owner only. usmfomo is an independent, unofficial student project, not affiliated with or
          endorsed by Universiti Sains Malaysia.
        </p>
      </footer>
    </div>
  )
}
