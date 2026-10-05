import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  onCta?: (e: MouseEvent<HTMLAnchorElement>) => void
  onLogin?: (e: MouseEvent<HTMLAnchorElement>) => void
  /** Rendered behind the text (the 3D canvas), after the placeholder image. */
  background?: ReactNode
  /** Rendered above the footer text (motion controls). */
  controls?: ReactNode
}

/**
 * The landing page markup. landing.html contains the same structure as static
 * HTML so the page paints before any JavaScript runs; LandingMarkup.test.tsx
 * keeps the two copies identical (English, no background/controls).
 */
export function LandingMarkup({ onCta, onLogin, background, controls }: Props) {
  const { t } = useTranslation('landing')
  return (
    <div className="landing" data-page="landing">
      <img className="landing-bg" src="/landing/placeholder.svg" alt="" fetchPriority="high" decoding="async" />
      {background}
      <header className="landing-top">
        <a className="landing-login" href="/login" onClick={onLogin}>
          <span>{t('login')}</span>
          <small>{t('loginNote')}</small>
        </a>
      </header>
      <main className="landing-center">
        <h1 className="landing-title">{t('title')}</h1>
        <p id="tagline" className="landing-tagline">
          {t('tagline')}
        </p>
        <a className="landing-cta" href="/dashboard" aria-describedby="tagline" onClick={onCta}>
          {t('cta')}
        </a>
      </main>
      <footer className="landing-footer">
        {controls}
        <p>{t('disclaimer')}</p>
      </footer>
    </div>
  )
}
