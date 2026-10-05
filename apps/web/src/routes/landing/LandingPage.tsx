import { useNavigate } from '@tanstack/react-router'
import { useLayoutEffect, type MouseEvent } from 'react'
import { isPlainClick } from '../../lib/links.ts'
import { LandingMarkup } from './LandingMarkup.tsx'

/**
 * "/" — static-first landing page. The 3D shattered-glass scene (P6) mounts as
 * a lazy chunk behind this markup; until then the generated placeholder image
 * is the background, and that stays the fallback for no-WebGL/reduced motion.
 */
export function LandingPage() {
  const navigate = useNavigate()

  // The static copy from landing.html sits on top of #root; React has now
  // rendered identical markup underneath, so remove the static copy before the
  // browser paints (useLayoutEffect) — no flash, idempotent under StrictMode.
  useLayoutEffect(() => {
    document.getElementById('landing-static')?.remove()
    document.title = "usmfomo — what's on at USM"
  }, [])

  const go = (to: '/dashboard' | '/login') => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    void navigate({ to })
  }

  return <LandingMarkup onCta={go('/dashboard')} onLogin={go('/login')} />
}
