// The shattered-glass landing scene, v1: plain three.js (no React Three Fiber,
// no drei). One renderer and an orthographic camera that fits the 1600x900
// scene like object-fit: cover; one ShapeGeometry mesh per shard with cover-UVs
// into the clip atlas (video / frame-0 still) or the posters atlas; two shared
// MeshBasicMaterials and one shared LineBasicMaterial for the crack edges.
// It renders only when something changes: a new video frame, pointer easing,
// the explosion, a resize.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  type VideoTexture,
} from 'three'
import { EXPLODE_MS, explosionFade, planExplosion, shardPose, type ShardMotion } from './explode.ts'
import { FrameMonitor, nextDpr } from './frameMonitor.ts'
import { coverView, SCENE_H, SCENE_W, toWorld, viewToScene, type ViewRect } from './layout.ts'
import { assignTiles, coverUv, insetPolygon, makeShards, mulberry32, type Point, type Shard } from './shards.ts'
import { tileCount, tileRect, type Grid } from './tilemap.ts'

export type FallbackReason = 'context-lost' | 'slow'

export type ShatterOptions = {
  canvas: HTMLCanvasElement
  count: number
  seed: number
  /** Highest pixel ratio (desktop 1.75, mobile 1.5). */
  dprCap: number
  /** Crack gap: each shard is inset by this many scene units. */
  crackInset: number
  /** The clip atlas layout (the video and its frame-0 still share it). */
  clips: Grid
  posters: Grid
  frame0: TexImageSource
  stills: TexImageSource
  /** Start with the parallax frozen (motion paused). */
  paused?: boolean
  onFirstFrame: () => void
  /** The scene cannot go on (context lost, too slow): show the placeholder. */
  onFallback: (reason: FallbackReason) => void
}

type Piece = {
  shard: Shard
  mesh: Mesh
  /** Resting position (world units) and tilt. */
  x: number
  y: number
  tiltX: number
  tiltY: number
  /** Parallax depth, 0.35 (far) .. 1 (near). */
  depth: number
  /** Where the explosion starts from (the rest position plus parallax). */
  fromX: number
  fromY: number
}

type Explosion = {
  start: number
  duration: number
  motions: ShardMotion[]
  done: boolean
  resolve: () => void
  promise: Promise<void>
  timer: number
}

/** Parallax travel at full pointer offset, scene units (the 8 % margin is 128 x 72). */
const PARALLAX_X = 22
const PARALLAX_Y = 14
/** Pointer easing time constant (ms). */
const EASE_MS = 140
const EDGE_OPACITY = 0.35
const CLEAR_COLOR = 0x07090d
/** Light for the baked per-shard shading (from the top left, towards the viewer). */
const LIGHT = new Vector3(-0.45, 0.6, 1).normalize()

function imageTexture(source: TexImageSource, mipmaps: boolean): Texture {
  const t = new Texture(source)
  t.colorSpace = SRGBColorSpace
  t.generateMipmaps = mipmaps
  t.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter
  t.magFilter = LinearFilter
  t.needsUpdate = true
  return t
}

export class ShatterScene {
  private readonly opts: ShatterOptions
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-SCENE_W / 2, SCENE_W / 2, SCENE_H / 2, -SCENE_H / 2, 0.1, 4000)
  private readonly root = new Group()
  private readonly frame0: Texture
  private readonly stills: Texture
  private readonly clipMaterial: MeshBasicMaterial
  private readonly stillsMaterial: MeshBasicMaterial
  private readonly edgeMaterial: LineBasicMaterial
  private readonly pieces: Piece[] = []
  private readonly monitor = new FrameMonitor()
  private readonly resizeObserver: ResizeObserver | null
  private view: ViewRect = coverView(SCENE_W, SCENE_H)
  private dprLimit: number
  private raf = 0
  private lastFrameAt = 0
  private continuous = false
  /** Set once shaders are compiled; nothing renders before that. */
  private started = false
  private firstFrameDone = false
  private disposed = false
  private failed = false
  private paused = false
  // Pointer target and eased value, -1..1 across the viewport.
  private targetX = 0
  private targetY = 0
  private pointerX = 0
  private pointerY = 0
  private video: HTMLVideoElement | null = null
  private videoTexture: VideoTexture | null = null
  private videoCallback = 0
  private videoTimer = 0
  private explosion: Explosion | null = null

  constructor(opts: ShatterOptions) {
    this.opts = opts
    this.dprLimit = opts.dprCap
    this.paused = opts.paused ?? false
    // Throws when WebGL2 (without a major performance caveat) is unavailable;
    // the caller shows the placeholder.
    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: true,
    })
    this.renderer.setClearColor(CLEAR_COLOR, 1)
    this.renderer.outputColorSpace = SRGBColorSpace
    opts.canvas.addEventListener('webglcontextlost', this.onContextLost)

    this.frame0 = imageTexture(opts.frame0, false)
    this.stills = imageTexture(opts.stills, true)
    this.clipMaterial = new MeshBasicMaterial({ map: this.frame0, side: DoubleSide, vertexColors: true })
    this.stillsMaterial = new MeshBasicMaterial({ map: this.stills, side: DoubleSide, vertexColors: true })
    this.edgeMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: EDGE_OPACITY, depthWrite: false })

    this.buildShards()
    this.scene.add(this.root)
    this.camera.position.z = 1000

    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    window.addEventListener('pointerout', this.onPointerOut, { passive: true })
    document.addEventListener('visibilitychange', this.onVisibility)
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(opts.canvas)
    } else {
      this.resizeObserver = null
      window.addEventListener('resize', this.onWindowResize)
    }
    this.resize()
    // Compile the shaders off the main thread where the browser can
    // (KHR_parallel_shader_compile), then draw the first frame.
    this.renderer
      .compileAsync(this.scene, this.camera)
      .catch(() => undefined)
      .then(() => {
        this.started = true
        this.invalidate()
      })
  }

  /** True once the first frame is on screen. */
  get ready(): boolean {
    return this.firstFrameDone && !this.disposed && !this.failed
  }

  private buildShards(): void {
    const { count, seed, crackInset, clips, posters } = this.opts
    const shards = makeShards({ width: SCENE_W, height: SCENE_H, count, seed })
    const clipTiles = tileCount(clips)
    const tiles = assignTiles(shards, clipTiles + tileCount(posters), seed)
    const rand = mulberry32(seed ^ 0x5bd1e995)
    for (const shard of shards) {
      const tile = tiles.get(shard.index) ?? 0
      const isClip = tile < clipTiles
      const rect = isClip ? tileRect(clips, tile) : tileRect(posters, tile - clipTiles)
      const [cx, cy] = shard.centroid
      const inner = insetPolygon(shard.polygon, shard.centroid, crackInset)

      // A small static tilt (4-8 degrees about a random in-plane axis).
      const angle = ((4 + 4 * rand()) * Math.PI) / 180
      const axis = rand() * Math.PI * 2
      const tiltX = angle * Math.cos(axis)
      const tiltY = angle * Math.sin(axis)
      const depth = 0.35 + 0.65 * rand()

      // Local coordinates around the centroid (world axes: y up).
      const local = inner.map(([x, y]) => new Vector2(x - cx, cy - y))
      const geometry = new ShapeGeometry(new Shape(local))
      const position = geometry.getAttribute('position')
      const uv = new Float32Array(position.count * 2)
      const color = new Float32Array(position.count * 3)
      // Baked shading from the tilt: a facet turned towards the light is a
      // little brighter, one turned away a little darker (an untilted facet
      // stays at 0.92), with a soft sheen across it. Subtle, so the media
      // stays clear.
      const normal = new Vector3(Math.sin(tiltY), -Math.sin(tiltX), 1).normalize()
      const facing = normal.dot(LIGHT) - LIGHT.z
      const radius = Math.max(1, ...local.map((p) => p.length()))
      for (let i = 0; i < position.count; i++) {
        const lx = position.getX(i)
        const ly = position.getY(i)
        const point: Point = [cx + lx, cy - ly]
        const [u, v] = coverUv(point, shard, rect)
        uv[i * 2] = u
        uv[i * 2 + 1] = v
        const sheen = ((lx * LIGHT.x + ly * LIGHT.y) / radius) * 0.06
        const shade = Math.min(1, Math.max(0.72, 0.92 + facing * 1.6 + sheen))
        color[i * 3] = shade
        color[i * 3 + 1] = shade
        color[i * 3 + 2] = shade
      }
      geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
      geometry.setAttribute('color', new Float32BufferAttribute(color, 3))

      const mesh = new Mesh(geometry, isClip ? this.clipMaterial : this.stillsMaterial)
      const [x, y] = toWorld(cx, cy)
      mesh.position.set(x, y, 0)
      mesh.rotation.set(tiltX, tiltY, 0)
      // Crack edge just above the facet, moving with it.
      const edge = new LineLoop(new BufferGeometry().setFromPoints(local.map((p) => new Vector3(p.x, p.y, 0.5))), this.edgeMaterial)
      mesh.add(edge)
      this.root.add(mesh)
      this.pieces.push({ shard, mesh, x, y, tiltX, tiltY, depth, fromX: x, fromY: y })
    }
  }

  // --- public API -----------------------------------------------------------

  /** Shows the video once it plays; null goes back to the frame-0 still. */
  setVideoTexture(texture: VideoTexture | null): void {
    if (this.disposed || texture === this.videoTexture) return
    this.stopVideoFrames()
    this.videoTexture = texture
    this.clipMaterial.map = texture ?? this.frame0
    this.clipMaterial.needsUpdate = true
    const video = texture ? (texture.image as HTMLVideoElement) : null
    this.video = video
    if (video) {
      // Each new video frame (24 fps) asks for one render.
      if (typeof video.requestVideoFrameCallback === 'function') {
        const onFrame = () => {
          this.invalidate()
          this.videoCallback = video.requestVideoFrameCallback(onFrame)
        }
        this.videoCallback = video.requestVideoFrameCallback(onFrame)
      } else {
        this.videoTimer = window.setInterval(() => {
          if (!video.paused) this.invalidate()
        }, 1000 / 24)
      }
    }
    this.invalidate()
  }

  /** Paused: the parallax freezes where it is (the video is paused by its owner). */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) {
      this.targetX = this.pointerX
      this.targetY = this.pointerY
    }
  }

  /**
   * Blows the glass out from `origin` (viewport px, e.g. the button's centre)
   * and resolves when it is over. Always resolves, even if frames stop
   * (hidden tab, lost context), so the caller can navigate.
   */
  explode(ms = EXPLODE_MS, origin?: { x: number; y: number }): Promise<void> {
    if (this.explosion) return this.explosion.promise
    if (!this.ready) return Promise.resolve()
    const center: Point = origin ? this.clientToScene(origin.x, origin.y) : [SCENE_W / 2, SCENE_H * 0.56]
    const motions = planExplosion(
      this.pieces.map((p) => p.shard),
      center,
      mulberry32(this.opts.seed + 7),
    )
    for (const p of this.pieces) {
      p.fromX = p.mesh.position.x
      p.fromY = p.mesh.position.y
    }
    let resolve = () => {}
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    const explosion: Explosion = { start: -1, duration: Math.max(1, ms), motions, done: false, resolve, promise, timer: 0 }
    explosion.timer = window.setTimeout(() => this.finishExplosion(), ms + 400)
    this.explosion = explosion
    this.invalidate()
    return promise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.stopVideoFrames()
    this.finishExplosion()
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerout', this.onPointerOut)
    window.removeEventListener('resize', this.onWindowResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.opts.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.resizeObserver?.disconnect()
    for (const piece of this.pieces) {
      piece.mesh.geometry.dispose()
      for (const child of piece.mesh.children) {
        if (child instanceof LineLoop) child.geometry.dispose()
      }
    }
    this.pieces.length = 0
    this.root.clear()
    this.clipMaterial.dispose()
    this.stillsMaterial.dispose()
    this.edgeMaterial.dispose()
    this.frame0.dispose()
    this.stills.dispose()
    // The video texture belongs to useAtlasVideo, which disposes it.
    this.video = null
    this.videoTexture = null
    this.renderer.dispose()
    // Free the context now instead of at garbage collection (browsers cap
    // live contexts; StrictMode and Back both create new ones).
    this.renderer.forceContextLoss()
  }

  // --- rendering --------------------------------------------------------------

  private invalidate(): void {
    if (this.raf || !this.started || this.disposed || this.failed) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    this.raf = 0
    if (this.disposed || this.failed) return
    const dt = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0
    if (this.continuous && dt > 0 && !this.explosion) this.watchFrameTime(dt)
    if (this.failed) return
    this.lastFrameAt = now

    const more = this.explosion ? this.stepExplosion(now) : this.stepParallax(dt)
    this.renderer.render(this.scene, this.camera)
    if (!this.firstFrameDone) {
      this.firstFrameDone = true
      this.opts.onFirstFrame()
    }
    // Frames are wanted back to back while easing or while the video plays;
    // only then are frame intervals a measure of how the device copes.
    this.continuous = more || this.videoPlaying()
    if (more) this.invalidate()
  }

  private videoPlaying(): boolean {
    const v = this.video
    return Boolean(v && !v.paused && !v.ended && v.readyState >= 2)
  }

  private stepParallax(dt: number): boolean {
    const k = dt > 0 ? 1 - Math.exp(-dt / EASE_MS) : 0
    this.pointerX += (this.targetX - this.pointerX) * k
    this.pointerY += (this.targetY - this.pointerY) * k
    const settled = Math.abs(this.targetX - this.pointerX) < 1e-3 && Math.abs(this.targetY - this.pointerY) < 1e-3
    if (settled) {
      this.pointerX = this.targetX
      this.pointerY = this.targetY
    }
    for (const p of this.pieces) {
      // Nearer shards move further, against the pointer, like looking past a pane.
      p.mesh.position.x = p.x - this.pointerX * PARALLAX_X * p.depth
      p.mesh.position.y = p.y + this.pointerY * PARALLAX_Y * p.depth
    }
    return !settled
  }

  private stepExplosion(now: number): boolean {
    const e = this.explosion
    if (!e || e.done) return false
    if (e.start < 0) e.start = now
    const t = Math.min(1, (now - e.start) / e.duration)
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i]
      const m = e.motions[i]
      if (!p || !m) continue
      const pose = shardPose(t, m)
      p.mesh.position.set(p.fromX + pose.x, p.fromY - pose.y, pose.z)
      p.mesh.rotation.set(p.tiltX + pose.rx, p.tiltY + pose.ry, pose.rz)
      p.mesh.scale.setScalar(pose.scale)
    }
    const fade = explosionFade(t)
    this.clipMaterial.color.setScalar(fade)
    this.stillsMaterial.color.setScalar(fade)
    this.edgeMaterial.opacity = EDGE_OPACITY * fade
    if (t >= 1) {
      this.finishExplosion()
      return false
    }
    return true
  }

  private finishExplosion(): void {
    const e = this.explosion
    if (!e || e.done) return
    e.done = true
    window.clearTimeout(e.timer)
    e.resolve()
  }

  private watchFrameTime(dt: number): void {
    if (this.monitor.sample(dt) !== 'slow') return
    const current = Math.min(window.devicePixelRatio || 1, this.dprLimit)
    const next = nextDpr(current, 1)
    if (next === null) {
      this.fail('slow')
      return
    }
    this.dprLimit = next
    this.monitor.reset()
    this.resize()
  }

  private resize(): void {
    if (this.disposed) return
    const canvas = this.opts.canvas
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprLimit))
    // false: three must not write inline styles; CSS sizes the canvas.
    this.renderer.setSize(width, height, false)
    this.view = coverView(width, height)
    this.camera.left = this.view.left
    this.camera.right = this.view.right
    this.camera.top = this.view.top
    this.camera.bottom = this.view.bottom
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  private clientToScene(x: number, y: number): Point {
    const rect = this.opts.canvas.getBoundingClientRect()
    const fx = rect.width > 0 ? (x - rect.left) / rect.width : 0.5
    const fy = rect.height > 0 ? (y - rect.top) / rect.height : 0.5
    return viewToScene(fx, fy, this.view)
  }

  private stopVideoFrames(): void {
    if (this.video && this.videoCallback) this.video.cancelVideoFrameCallback(this.videoCallback)
    this.videoCallback = 0
    if (this.videoTimer) window.clearInterval(this.videoTimer)
    this.videoTimer = 0
  }

  private fail(reason: FallbackReason): void {
    if (this.failed || this.disposed) return
    this.failed = true
    this.finishExplosion()
    this.opts.onFallback(reason)
  }

  // --- events -------------------------------------------------------------------

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.paused || this.explosion) return
    const w = window.innerWidth || 1
    const h = window.innerHeight || 1
    this.targetX = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1))
    this.targetY = Math.max(-1, Math.min(1, (e.clientY / h) * 2 - 1))
    this.invalidate()
  }

  private readonly onPointerOut = (e: PointerEvent): void => {
    // Left the window: drift back to rest.
    if (e.relatedTarget || this.paused || this.explosion) return
    this.targetX = 0
    this.targetY = 0
    this.invalidate()
  }

  private readonly onVisibility = (): void => {
    // Intervals across a hidden period are not frame times.
    this.lastFrameAt = 0
    this.continuous = false
    this.monitor.reset()
    if (document.visibilityState === 'visible') this.invalidate()
  }

  private readonly onWindowResize = (): void => this.resize()

  private readonly onContextLost = (): void => this.fail('context-lost')
}
