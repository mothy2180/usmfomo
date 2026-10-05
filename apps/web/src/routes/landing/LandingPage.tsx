import { useNavigate, useRouter } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { EXPLODE_MS } from '../../landing3d/explode.ts'
import { focusPageHeading } from '../../landing3d/focus.ts'
import {
  hasWebGL2,
  markSceneFailed,
  needsWebGL2Probe,
  resolveMotion,
  saveDataOn,
  sceneFailedBefore,
  sceneGate,
  shouldExplode,
} from '../../landing3d/gating.ts'
import { useIdle, useReducedMotion } from '../../landing3d/hooks.ts'
import { MotionControls } from '../../landing3d/MotionControls.tsx'
import { readStoredPrefs, writeLitePref, writeMotionPref, type StoredPrefs } from '../../landing3d/prefs.ts'
import { SceneBoundary } from '../../landing3d/SceneBoundary.tsx'
import { NO_STATUS, type SceneApi, type SceneStatus } from '../../landing3d/types.ts'
import { isPlainClick } from '../../lib/links.ts'
import { LandingMarkup } from './LandingMarkup.tsx'

// three.js, d3-delaunay and the media are a separate chunk, downloaded only
// when the gate allows the scene (never for the dashboard or other routes).
const LandingScene = lazy(() => import('../../landing3d/LandingScene.tsx'))

/**
 * "/" — static-first landing page. The generated placeholder image is the
 * background (and stays the fallback for no WebGL2, reduced motion, lite mode
 * or a paused page); the 3D shattered-glass scene fades in over it when allowed.
 */
export function LandingPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const idle = useIdle()
  const [stored, setStored] = useState<StoredPrefs>(readStoredPrefs)
  const [saveData] = useState(saveDataOn)
  const { paused, lite } = resolveMotion(stored, { reducedMotion, saveData })
  const [failed, setFailed] = useState(sceneFailedBefore)
  const [webgl2, setWebgl2] = useState<boolean | null>(null)
  // Set when the visitor pauses a running scene: it then stays mounted, frozen.
  const [keepWhilePaused, setKeepWhilePaused] = useState(false)
  const [status, setStatus] = useState<SceneStatus>(NO_STATUS)
  const sceneApi = useRef<SceneApi | null>(null)
  const leaving = useRef(false)

  // The static copy from landing.html sits on top of #root; React has now
  // rendered identical markup underneath, so remove the static copy before the
  // browser paints (useLayoutEffect) — no flash, idempotent under StrictMode.
  useLayoutEffect(() => {
    document.getElementById('landing-static')?.remove()
    document.title = "usmfomo — what's on at USM"
  }, [])

  const gateInput = { idle, failed, lite, paused, mounted: keepWhilePaused }
  // The probe creates a throwaway WebGL context, so it runs (once) only when
  // the scene could actually mount, in its own task after the page is idle.
  const probe = needsWebGL2Probe(gateInput)
  useEffect(() => {
    if (!probe || webgl2 !== null) return
    const id = window.setTimeout(() => setWebgl2(hasWebGL2()), 0)
    return () => window.clearTimeout(id)
  }, [probe, webgl2])

  const mount = sceneGate({ ...gateInput, webgl2 }) === 'mount'

  const fail = () => {
    markSceneFailed()
    sceneApi.current = null
    setFailed(true)
  }
  const onReady = (api: SceneApi | null) => {
    sceneApi.current = api
  }

  // Pausing a running scene freezes it; lite mode unloads it (and nothing
  // more is downloaded until lite mode is off again).
  const togglePaused = () => {
    const next = paused ? 'playing' : 'paused'
    writeMotionPref(next)
    setStored((s) => ({ ...s, motion: next }))
    if (next === 'paused') setKeepWhilePaused(mount)
  }
  const toggleLite = () => {
    const next = lite ? 'off' : 'on'
    writeLitePref(next)
    setStored((s) => ({ ...s, lite: next }))
    if (next === 'on') setKeepWhilePaused(false)
  }

  const goToDashboard = () => {
    void navigate({ to: '/dashboard' })
      .then(() => focusPageHeading())
      .catch(() => undefined)
      .finally(() => {
        leaving.current = false
      })
  }

  const onCta = (e: MouseEvent<HTMLAnchorElement>) => {
    // Modifier and middle clicks open a new tab or window as usual.
    const plainClick = isPlainClick(e)
    if (!plainClick) return
    e.preventDefault()
    if (leaving.current) return
    leaving.current = true
    const api = sceneApi.current
    const animate = shouldExplode({
      plainClick,
      reducedMotion,
      paused,
      sceneReady: api !== null,
      hidden: document.visibilityState === 'hidden',
    })
    if (!api || !animate) {
      goToDashboard()
      return
    }
    // Fetch the dashboard chunk while the glass flies; navigate when the
    // explosion ends whether or not that finished (it then loads as usual).
    void router.preloadRoute({ to: '/dashboard' }).catch(() => undefined)
    const r = e.currentTarget.getBoundingClientRect()
    void api.explode(EXPLODE_MS, { x: r.left + r.width / 2, y: r.top + r.height / 2 }).finally(goToDashboard)
  }

  const onLogin = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    void navigate({ to: '/login' })
  }

  const background = mount ? (
    <SceneBoundary onError={fail}>
      <Suspense fallback={null}>
        <LandingScene paused={paused} onReady={onReady} onFallback={fail} onStatus={setStatus} />
      </Suspense>
    </SceneBoundary>
  ) : null

  return (
    <LandingMarkup
      onCta={onCta}
      onLogin={onLogin}
      background={background}
      controls={
        <MotionControls
          paused={paused}
          lite={lite}
          status={mount ? status : NO_STATUS}
          onTogglePaused={togglePaused}
          onToggleLite={toggleLite}
        />
      }
    />
  )
}
