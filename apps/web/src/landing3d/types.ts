// Types and constants shared by the eager landing page and the lazy 3D
// chunk. Nothing here imports three.js, so the main bundle stays free of it.

/** What the landing page may ask of a running scene. */
export type SceneApi = {
  /** Plays the "I'm FOMO" warp (the glass rushes past, the view fades to
   * black); always resolves. */
  warp: (ms: number) => Promise<void>
}

/** Length of the warp; LandingPage navigates when it ends. */
export const WARP_MS = 900

/** Shown under the motion controls. */
export type SceneStatus = {
  /** Video download progress 0..1, or null when not downloading. */
  progress: number | null
  /** Autoplay was refused; the next tap or key press starts the clips. */
  blocked: boolean
}

export const NO_STATUS: SceneStatus = { progress: null, blocked: false }

export type SceneProps = {
  paused: boolean
  /** The scene drew its first frame (api) or went away (null). */
  onReady: (api: SceneApi | null) => void
  /** The scene cannot run here (WebGL error, lost context, too slow, media
   * missing): the page keeps the placeholder from now on. */
  onFallback: (reason: string) => void
  onStatus: (status: SceneStatus) => void
}
