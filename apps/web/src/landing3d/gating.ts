// When the landing page may load the 3D scene. The decisions are pure
// functions (unit-tested); the small probes below read the browser.
import type { StoredPrefs } from './prefs.ts'

export type MotionEnv = { reducedMotion: boolean; saveData: boolean }
export type Motion = { paused: boolean; lite: boolean }

/**
 * Reduced motion starts the page paused and Data Saver starts it in lite mode.
 * Once the visitor presses a toggle, their remembered choice wins.
 */
export function resolveMotion(stored: StoredPrefs, env: MotionEnv): Motion {
  return {
    paused: stored.motion === 'paused' || (stored.motion !== 'playing' && env.reducedMotion),
    lite: stored.lite === 'on' || (stored.lite !== 'off' && env.saveData),
  }
}

export type SceneGate = 'mount' | 'wait' | 'failed' | 'lite' | 'paused' | 'no-webgl2'

export type GateInput = {
  /** The page has painted and the browser is idle. */
  idle: boolean
  /** The scene fell back earlier in this page's life (context lost, too slow, load error). */
  failed: boolean
  lite: boolean
  paused: boolean
  /** The scene is already mounted: pausing freezes it instead of unloading it. */
  mounted: boolean
  /** Result of the WebGL2 probe; null until it ran. */
  webgl2: boolean | null
}

/**
 * Whether to mount the 3D scene now. Nothing is downloaded unless this says
 * 'mount': lite mode and a paused page keep the static placeholder, and so
 * does a browser without a fast-enough WebGL2.
 */
export function sceneGate(g: GateInput): SceneGate {
  if (g.failed) return 'failed'
  if (g.lite) return 'lite'
  if (g.paused && !g.mounted) return 'paused'
  if (!g.idle || g.webgl2 === null) return 'wait'
  return g.webgl2 ? 'mount' : 'no-webgl2'
}

/** Whether the probe is worth running (it creates a throwaway WebGL context). */
export function needsWebGL2Probe(g: Omit<GateInput, 'webgl2'>): boolean {
  return g.idle && !g.failed && !g.lite && (!g.paused || g.mounted)
}

export type WarpInput = {
  /** Left click without modifier keys (others open a new tab/window as usual). */
  plainClick: boolean
  reducedMotion: boolean
  paused: boolean
  sceneReady: boolean
  /** The tab is hidden: animation frames would not run. */
  hidden: boolean
}

/** Whether "I'm FOMO" plays the warp before navigating. */
export function shouldWarp(e: WarpInput): boolean {
  return e.plainClick && !e.reducedMotion && !e.paused && e.sceneReady && !e.hidden
}

// --- probes --------------------------------------------------------------

/**
 * WebGL2 with no major performance caveat (no software rendering). The test
 * context is released straight away with WEBGL_lose_context, because browsers
 * cap the number of live contexts.
 */
export function probeWebGL2(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas')
    const gl = canvas.getContext('webgl2', {
      failIfMajorPerformanceCaveat: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

let webgl2: boolean | undefined

/** probeWebGL2, run once per page. */
export function hasWebGL2(): boolean {
  webgl2 ??= probeWebGL2()
  return webgl2
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(win: Window = window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia(REDUCED_MOTION_QUERY).matches
}

type NetworkInformationLike = { saveData?: boolean }

/** Data Saver / Lite mode in the browser (Network Information API, Chromium only). */
export function saveDataOn(nav: Navigator = navigator): boolean {
  const connection = (nav as Navigator & { connection?: NetworkInformationLike }).connection
  return connection?.saveData === true
}

// A scene that failed once (lost context, too slow, media error) is not tried
// again until the page reloads; coming Back to "/" keeps the placeholder.
let failedOnce = false

export function sceneFailedBefore(): boolean {
  return failedOnce
}

export function markSceneFailed(): void {
  failedOnce = true
}
