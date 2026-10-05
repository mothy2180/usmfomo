// The lazy part of the landing page (its own chunk, with three.js and
// d3-delaunay): picks the media for this device, builds the scene on a fresh
// canvas and feeds it the video once it plays.
import { useEffect, useEffectEvent, useState } from 'react'
import { chooseAtlas, type AtlasChoice } from './atlas.ts'
import { planScene } from './layout.ts'
import { loadImage, mediaUrl, TILEMAP } from './media.ts'
import { ShatterScene } from './ShatterScene.ts'
import type { SceneProps } from './types.ts'
import { useAtlasVideo } from './useAtlasVideo.ts'

type Media = { choice: AtlasChoice; frame0: HTMLImageElement; stills: HTMLImageElement }

export default function LandingScene({ paused, onReady, onFallback, onStatus }: SceneProps) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const [plan] = useState(() => planScene(window.innerWidth, window.innerHeight))
  const [media, setMedia] = useState<Media | null>(null)
  const [scene, setScene] = useState<ShatterScene | null>(null)
  const ready = useEffectEvent(onReady)
  const fallback = useEffectEvent(onFallback)
  const report = useEffectEvent(onStatus)
  // Read when a scene is created; later changes go through setPaused().
  const pausedNow = useEffectEvent(() => paused)

  // 1. The atlas this device decodes smoothly, then the two stills: frame 0 of
  //    the clips and the posters. They are small, so the glass shows early.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const choice = await chooseAtlas(plan.cls, TILEMAP)
      const [frame0, stills] = await Promise.all([
        loadImage(mediaUrl(TILEMAP.video[choice.clips].frame0)),
        loadImage(mediaUrl(TILEMAP.stills[choice.stills].file)),
      ])
      if (!cancelled) setMedia({ choice, frame0, stills })
    }
    load().catch(() => {
      if (!cancelled) fallback('media')
    })
    return () => {
      cancelled = true
    }
  }, [plan])

  // 2. The scene, on a new canvas each time: a context that was disposed (or
  //    lost) cannot be reused, and StrictMode mounts twice.
  useEffect(() => {
    if (!media || !layer) return
    const canvas = document.createElement('canvas')
    canvas.className = 'landing-canvas l3d-canvas'
    layer.prepend(canvas)
    let shatter: ShatterScene
    try {
      shatter = new ShatterScene({
        canvas,
        count: plan.count,
        seed: plan.seed,
        dprCap: plan.dprCap,
        crackInset: plan.crackInset,
        clips: TILEMAP.video[media.choice.clips],
        posters: TILEMAP.stills[media.choice.stills],
        frame0: media.frame0,
        stills: media.stills,
        paused: pausedNow(),
        onFirstFrame: () => {
          // The placeholder stays visible until now; then the canvas fades in.
          canvas.classList.add('is-visible')
          setScene(shatter)
          ready({ explode: (ms, origin) => shatter.explode(ms, origin) })
        },
        onFallback: (reason) => fallback(reason),
      })
    } catch {
      canvas.remove()
      fallback('webgl')
      return
    }
    return () => {
      ready(null)
      setScene(null)
      shatter.dispose()
      canvas.remove()
    }
  }, [media, layer, plan])

  // 3. The video atlas, when the browser can decode it smoothly. It downloads
  //    after the first frame (`scene` is set then), so the stills come first
  //    and a page opened in a background tab fetches nothing big.
  const clipAtlas = media?.choice.video && scene ? TILEMAP.video[media.choice.clips] : null
  const video = useAtlasVideo({
    src: clipAtlas ? mediaUrl(clipAtlas.file) : null,
    expectedBytes: clipAtlas?.bytes ?? 0,
    paused,
    host: layer,
  })

  useEffect(() => {
    scene?.setVideoTexture(video.texture)
  }, [scene, video.texture])

  useEffect(() => {
    scene?.setPaused(paused)
  }, [scene, paused])

  useEffect(() => {
    report({ progress: video.progress, blocked: video.blocked && !paused })
  }, [video.progress, video.blocked, paused])

  return <div ref={setLayer} className="l3d-layer" aria-hidden="true" />
}
