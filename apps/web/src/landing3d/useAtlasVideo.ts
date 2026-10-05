// The video atlas as a three.js texture: download (cached Blob) -> a muted,
// inline, looping <video> kept 1x1 px in the DOM -> VideoTexture. The texture
// is handed out only once the video has shown a frame; until then (and when
// play() is refused) the scene keeps showing the frame-0 still.
import { useEffect, useState } from 'react'
import { SRGBColorSpace, VideoTexture } from 'three'
import { acquireVideo, objectUrlFor } from './videoBlob.ts'

export type AtlasVideo = {
  /** Downloading: 0..1, else null. */
  progress: number | null
  /** Set once the video has presented a frame; the scene shows it from then on. */
  texture: VideoTexture | null
  /** play() was refused (iOS Low Power Mode, Safari "Never Auto-Play"):
   * waiting for the next tap, click or key press. */
  blocked: boolean
  /** Download or decode failed: stills only for this visit. */
  failed: boolean
}

export type AtlasVideoOptions = {
  /** Video URL, or null for stills only. */
  src: string | null
  expectedBytes: number
  paused: boolean
  /** Where the <video> element lives (the scene's layer). */
  host: HTMLElement | null
}

const IDLE: AtlasVideo = { progress: null, texture: null, blocked: false, failed: false }

/** Events that count as a user gesture for media playback. */
const GESTURES = ['click', 'pointerup', 'touchend', 'keydown'] as const

export function createAtlasVideoElement(url: string): HTMLVideoElement {
  const el = document.createElement('video')
  // Muted + inline is what lets a video start without a gesture; set both the
  // properties and (via defaultMuted / playsInline) the attributes. No autoplay
  // attribute: play() is called explicitly so a refusal can be handled.
  el.muted = true
  el.defaultMuted = true
  el.playsInline = true
  el.loop = true
  el.preload = 'auto'
  el.disablePictureInPicture = true
  el.disableRemotePlayback = true
  el.tabIndex = -1
  el.setAttribute('aria-hidden', 'true')
  // Never display:none (browsers stop decoding hidden videos): 1x1 px instead.
  el.className = 'l3d-video'
  el.src = url
  return el
}

const errorName = (err: unknown): string => (err instanceof DOMException || err instanceof Error ? err.name : '')

type Player = { el: HTMLVideoElement; texture: VideoTexture; src: string; blob: Blob }

export function useAtlasVideo({ src, expectedBytes, paused, host }: AtlasVideoOptions): AtlasVideo {
  const [state, setState] = useState<AtlasVideo>(IDLE)
  const [player, setPlayer] = useState<Player | null>(null)

  // Download (or reuse the cached Blob), then build the element and texture.
  useEffect(() => {
    if (!src || !host) return
    let cancelled = false
    let built: Player | null = null
    const lease = acquireVideo(src, {
      expectedBytes,
      onProgress: (f) => {
        if (!cancelled) setState((s) => (s.texture || s.failed ? s : { ...s, progress: f < 1 ? f : null }))
      },
    })
    lease.blob.then(
      (blob) => {
        if (cancelled) return
        const el = createAtlasVideoElement(objectUrlFor(src, blob))
        host.appendChild(el)
        const texture = new VideoTexture(el)
        texture.colorSpace = SRGBColorSpace
        built = { el, texture, src, blob }
        setPlayer(built)
      },
      () => {
        if (!cancelled) setState({ ...IDLE, failed: true })
      },
    )
    // Back/forward cache: the Blob URL was revoked on pagehide.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !built) return
      built.el.src = objectUrlFor(built.src, built.blob)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      cancelled = true
      window.removeEventListener('pageshow', onPageShow)
      lease.release()
      setPlayer(null)
      setState(IDLE)
      if (built) {
        built.el.pause()
        built.el.removeAttribute('src')
        built.el.load()
        built.el.remove()
        built.texture.dispose()
      }
    }
  }, [src, host, expectedBytes])

  // Play / pause (also when the tab is hidden), and the retry on the first
  // gesture when autoplay is refused.
  useEffect(() => {
    if (!player) return
    const { el, texture } = player
    let stopped = false
    let armed = false

    const showFrames = () => {
      const done = () => {
        if (!stopped) setState({ progress: null, texture, blocked: false, failed: false })
      }
      // The first presented frame, so the texture never uploads an empty video.
      if (typeof el.requestVideoFrameCallback === 'function') el.requestVideoFrameCallback(done)
      else done()
    }
    const disarm = () => {
      if (!armed) return
      armed = false
      for (const g of GESTURES) window.removeEventListener(g, onGesture, true)
    }
    const play = () => {
      Promise.resolve(el.play()).then(
        () => {
          if (stopped) return
          disarm()
          showFrames()
        },
        (err: unknown) => {
          if (stopped) return
          const name = errorName(err)
          if (name === 'NotAllowedError') {
            setState((s) => ({ ...s, blocked: true }))
            arm()
          } else if (name !== 'AbortError') {
            // NotSupportedError and friends: keep the stills.
            setState((s) => (s.texture ? s : { ...IDLE, failed: true }))
          }
        },
      )
    }
    function onGesture() {
      if (!stopped && document.visibilityState === 'visible') play()
    }
    function arm() {
      if (armed) return
      armed = true
      for (const g of GESTURES) window.addEventListener(g, onGesture, { capture: true, passive: true })
    }
    const sync = () => {
      if (paused || document.visibilityState === 'hidden') {
        el.pause()
        return
      }
      play()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stopped = true
      disarm()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [player, paused])

  return state
}
