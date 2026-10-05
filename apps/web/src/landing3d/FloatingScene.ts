// The landing scene: glass shards floating in a dark space, drifting
// slowly towards and past the camera, tumbling gently and catching the light.
// About a third are larger facets that show the clips (video atlas) and
// posters (stills atlas); the rest are thin clear splinters with bright edges.
// Shards that pass the camera re-enter far away, so the stream never ends.
// Plain three.js; the motion maths lives in field.ts (unit-tested).
import {
  AdditiveBlending,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  LineLoop,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
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
import {
  FOG_FAR,
  FOG_NEAR,
  FOV_DEG,
  makeField,
  recycle,
  rotatedNormal,
  shardLook,
  shouldRecycle,
  stepShard,
  TileDeck,
  warpProfile,
  type FieldShard,
} from './field.ts'
import { FrameMonitor, nextDpr } from './frameMonitor.ts'
import type { FieldPlan } from './layout.ts'
import { mulberry32 } from './random.ts'
import { coverUvs, tileCount, tileRect, type Grid } from './tilemap.ts'

export type FallbackReason = 'context-lost' | 'slow'

export type FloatingOptions = {
  canvas: HTMLCanvasElement
  plan: FieldPlan
  seed: number
  /** The clip atlas layout (the video and its frame-0 still share it). */
  clips: Grid
  posters: Grid
  frame0: TexImageSource
  stills: TexImageSource
  /** Start frozen (motion paused). */
  paused?: boolean
  onFirstFrame: () => void
  /** The scene cannot go on (context lost, too slow): show the placeholder. */
  onFallback: (reason: FallbackReason) => void
}

type Piece = {
  shard: FieldShard
  group: Group
  face: Mesh
  faceMaterial: MeshBasicMaterial
  edge: LineLoop
  edgeMaterial: LineBasicMaterial
  /** Media only: an additive copy of the face that flashes when it catches the light. */
  glow: Mesh | null
  glowMaterial: MeshBasicMaterial | null
  /** Media only: tile index; below the clip count it is a clip, else a poster. */
  tile: number
  /** Hidden for the rest of the warp once it has passed the camera. */
  gone: boolean
}

type Warp = {
  start: number
  duration: number
  done: boolean
  resolve: () => void
  promise: Promise<void>
  timer: number
}

const CLEAR_COLOR = 0x05070b
const EDGE_COLOR = 0xe6eeff
const CLEAR_FACE_COLOR = 0xb8cdf0
/** Pointer parallax: the camera moves up to this far (world units). */
const PARALLAX = 0.55
const EASE_MS = 220
/** Longest step (s) applied in one frame, so a hitch never teleports the field. */
const MAX_DT = 0.05

function imageTexture(source: TexImageSource, mipmaps: boolean): Texture {
  const t = new Texture(source)
  t.colorSpace = SRGBColorSpace
  t.generateMipmaps = mipmaps
  t.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter
  t.magFilter = LinearFilter
  t.needsUpdate = true
  return t
}

export class FloatingScene {
  private readonly opts: FloatingOptions
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly root = new Group()
  private readonly frame0: Texture
  private readonly stills: Texture
  private readonly pieces: Piece[] = []
  private readonly deck: TileDeck
  private readonly rand: () => number
  private readonly clipTiles: number
  private readonly monitor = new FrameMonitor()
  private readonly resizeObserver: ResizeObserver | null
  private readonly lookTarget = new Vector3(0, 0, -20)
  private aspect = 16 / 9
  private dprLimit: number
  private raf = 0
  private lastFrameAt = 0
  private started = false
  private firstFrameDone = false
  private disposed = false
  private failed = false
  private paused: boolean
  private thinned = false
  private targetX = 0
  private targetY = 0
  private pointerX = 0
  private pointerY = 0
  private videoTexture: VideoTexture | null = null
  private warping: Warp | null = null

  constructor(opts: FloatingOptions) {
    this.opts = opts
    this.dprLimit = opts.plan.dprCap
    this.paused = opts.paused ?? false
    this.rand = mulberry32(opts.seed ^ 0x2f6b9a1d)
    this.clipTiles = tileCount(opts.clips)
    this.deck = new TileDeck(this.clipTiles + tileCount(opts.posters), opts.seed)
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

    this.camera = new PerspectiveCamera(FOV_DEG, this.aspect, 0.1, 80)
    this.scene.fog = new Fog(CLEAR_COLOR, FOG_NEAR, FOG_FAR)
    this.frame0 = imageTexture(opts.frame0, false)
    this.stills = imageTexture(opts.stills, true)

    this.aspect = this.viewAspect()
    for (const shard of makeField(opts.plan, this.aspect, opts.seed)) this.pieces.push(this.buildPiece(shard))
    this.scene.add(this.root)

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

  // --- building ----------------------------------------------------------------

  private buildPiece(shard: FieldShard): Piece {
    const group = new Group()
    const media = shard.kind === 'media'
    const tile = media ? this.deck.next() : -1
    const faceMaterial = media
      ? new MeshBasicMaterial({ map: this.mapFor(tile), side: DoubleSide, transparent: true, opacity: 0.94 })
      : new MeshBasicMaterial({
          color: CLEAR_FACE_COLOR,
          side: DoubleSide,
          transparent: true,
          opacity: 0.08,
          blending: AdditiveBlending,
          depthWrite: false,
        })
    const geometry = this.faceGeometry(shard, tile)
    const face = new Mesh(geometry, faceMaterial)
    group.add(face)

    let glow: Mesh | null = null
    let glowMaterial: MeshBasicMaterial | null = null
    if (media) {
      glowMaterial = new MeshBasicMaterial({
        color: EDGE_COLOR,
        side: DoubleSide,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      })
      glow = new Mesh(geometry, glowMaterial)
      glow.renderOrder = 1
      group.add(glow)
    }

    const edgeMaterial = new LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    const edge = new LineLoop(this.edgeGeometry(shard), edgeMaterial)
    edge.renderOrder = 2
    group.add(edge)

    this.root.add(group)
    const piece: Piece = { shard, group, face, faceMaterial, edge, edgeMaterial, glow, glowMaterial, tile, gone: false }
    this.place(piece)
    return piece
  }

  private faceGeometry(shard: FieldShard, tile: number): ShapeGeometry {
    const geometry = new ShapeGeometry(new Shape(shard.polygon.map(([x, y]) => new Vector2(x, y))))
    if (shard.kind === 'media') {
      const position = geometry.getAttribute('position')
      const rect = tile < this.clipTiles ? tileRect(this.opts.clips, tile) : tileRect(this.opts.posters, tile - this.clipTiles)
      geometry.setAttribute('uv', new Float32BufferAttribute(coverUvs(shard.polygon, rect, position.array, position.count), 2))
    }
    return geometry
  }

  private edgeGeometry(shard: FieldShard): BufferGeometry {
    return new BufferGeometry().setFromPoints(shard.polygon.map(([x, y]) => new Vector3(x, y, 0.002)))
  }

  private mapFor(tile: number): Texture {
    if (tile < this.clipTiles) return this.videoTexture ?? this.frame0
    return this.stills
  }

  /** New shape, motion and (for media) tile for a recycled shard. */
  private refresh(piece: Piece): void {
    recycle(piece.shard, this.rand, { aspect: this.aspect, speed: this.opts.plan.speed })
    piece.face.geometry.dispose()
    piece.edge.geometry.dispose()
    if (piece.shard.kind === 'media') {
      piece.tile = this.deck.next()
      const map = this.mapFor(piece.tile)
      if (piece.faceMaterial.map !== map) {
        piece.faceMaterial.map = map
        piece.faceMaterial.needsUpdate = true
      }
    }
    const geometry = this.faceGeometry(piece.shard, piece.tile)
    piece.face.geometry = geometry
    if (piece.glow) piece.glow.geometry = geometry
    piece.edge.geometry = this.edgeGeometry(piece.shard)
  }

  /** Position, orientation and light-dependent brightness of one piece. */
  private place(piece: Piece, fade = 1): void {
    const { shard, group } = piece
    const [x, y, z] = shard.position
    group.position.set(x, y, z)
    group.quaternion.set(shard.quat[0], shard.quat[1], shard.quat[2], shard.quat[3])
    const look = shardLook(shard.kind, rotatedNormal(shard.quat), z, fade)
    piece.faceMaterial.opacity = look.faceOpacity
    if (shard.kind === 'media') piece.faceMaterial.color.setScalar(look.brightness)
    if (piece.glowMaterial) piece.glowMaterial.opacity = look.glowOpacity
    piece.edgeMaterial.opacity = look.edgeOpacity
  }

  // --- public API -----------------------------------------------------------------

  /** Shows the video once it plays; null goes back to the frame-0 still. */
  setVideoTexture(texture: VideoTexture | null): void {
    if (this.disposed || texture === this.videoTexture) return
    this.videoTexture = texture
    for (const piece of this.pieces) {
      if (piece.shard.kind !== 'media' || piece.tile >= this.clipTiles) continue
      piece.faceMaterial.map = texture ?? this.frame0
      piece.faceMaterial.needsUpdate = true
    }
    this.invalidate()
  }

  /** Paused: the field freezes where it is (the video is paused by its owner). */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) {
      this.targetX = this.pointerX
      this.targetY = this.pointerY
    }
    this.lastFrameAt = 0
    this.invalidate()
  }

  /**
   * The "I'm FOMO" warp: the shards rush past the camera and the view fades
   * to black. Always resolves, even if frames stop (hidden tab, lost context),
   * so the caller can navigate.
   */
  warp(ms: number): Promise<void> {
    if (this.warping) return this.warping.promise
    if (!this.ready) return Promise.resolve()
    let resolve = () => {}
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    const warp: Warp = { start: -1, duration: Math.max(1, ms), done: false, resolve, promise, timer: 0 }
    warp.timer = window.setTimeout(() => this.finishWarp(), ms + 400)
    this.warping = warp
    this.lastFrameAt = 0
    this.invalidate()
    return promise
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.finishWarp()
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerout', this.onPointerOut)
    window.removeEventListener('resize', this.onWindowResize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.opts.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.resizeObserver?.disconnect()
    for (const p of this.pieces) {
      p.face.geometry.dispose()
      p.edge.geometry.dispose()
      p.faceMaterial.dispose()
      p.edgeMaterial.dispose()
      p.glowMaterial?.dispose()
    }
    this.pieces.length = 0
    this.root.clear()
    this.frame0.dispose()
    this.stills.dispose()
    // The video texture belongs to useAtlasVideo, which disposes it.
    this.videoTexture = null
    this.renderer.dispose()
    // Free the context now instead of at garbage collection (browsers cap
    // live contexts; StrictMode and Back both create new ones).
    this.renderer.forceContextLoss()
  }

  // --- rendering --------------------------------------------------------------------

  private invalidate(): void {
    if (this.raf || !this.started || this.disposed || this.failed) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    this.raf = 0
    if (this.disposed || this.failed) return
    const dtMs = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0
    const moving = !this.paused || this.warping !== null
    if (moving && dtMs > 0 && !this.warping) this.watchFrameTime(dtMs)
    if (this.failed) return
    this.lastFrameAt = now
    const dt = Math.min(MAX_DT, dtMs / 1000)

    let fade = 1
    let speedMul = 1
    if (this.warping) {
      const w = this.warping
      if (w.start < 0) w.start = now
      const t = Math.min(1, (now - w.start) / w.duration)
      const profile = warpProfile(t)
      fade = profile.fade
      speedMul = profile.speedMul
      if (this.camera.fov !== profile.fov) {
        this.camera.fov = profile.fov
        this.camera.updateProjectionMatrix()
      }
      if (t >= 1) this.finishWarp()
    }

    this.easePointer(dtMs)
    for (const piece of this.pieces) {
      if (piece.gone || !piece.group.visible) continue
      if (moving && dt > 0) stepShard(piece.shard, dt, speedMul)
      if (shouldRecycle(piece.shard, this.aspect)) {
        if (this.warping) {
          piece.gone = true
          piece.group.visible = false
          continue
        }
        this.refresh(piece)
      }
      this.place(piece, fade)
    }
    this.renderer.render(this.scene, this.camera)
    if (!this.firstFrameDone) {
      this.firstFrameDone = true
      this.opts.onFirstFrame()
    }
    // Continuous while the field moves (or the pointer eases); otherwise
    // only on demand (resize, a new video texture, unpausing).
    if (moving || !this.pointerSettled()) this.invalidate()
  }

  private easePointer(dtMs: number): void {
    const k = dtMs > 0 ? 1 - Math.exp(-dtMs / EASE_MS) : 0
    this.pointerX += (this.targetX - this.pointerX) * k
    this.pointerY += (this.targetY - this.pointerY) * k
    this.camera.position.set(this.pointerX * PARALLAX, -this.pointerY * PARALLAX * 0.7, 0)
    this.camera.lookAt(this.lookTarget)
  }

  private pointerSettled(): boolean {
    return Math.abs(this.targetX - this.pointerX) < 1e-3 && Math.abs(this.targetY - this.pointerY) < 1e-3
  }

  private finishWarp(): void {
    const w = this.warping
    if (!w || w.done) return
    w.done = true
    window.clearTimeout(w.timer)
    w.resolve()
  }

  private watchFrameTime(dtMs: number): void {
    if (this.monitor.sample(dtMs) !== 'slow') return
    const current = Math.min(window.devicePixelRatio || 1, this.dprLimit)
    const next = nextDpr(current, 1)
    if (next !== null) {
      this.dprLimit = next
      this.monitor.reset()
      this.resize()
      return
    }
    if (!this.thinned) {
      // Still slow at 1x: drop every other clear splinter.
      this.thinned = true
      let i = 0
      for (const p of this.pieces) {
        if (p.shard.kind === 'clear' && i++ % 2 === 0) p.group.visible = false
      }
      this.monitor.reset()
      return
    }
    this.fail('slow')
  }

  private viewAspect(): number {
    const canvas = this.opts.canvas
    const width = canvas.clientWidth || window.innerWidth || 1
    const height = canvas.clientHeight || window.innerHeight || 1
    return width / height
  }

  private resize(): void {
    if (this.disposed) return
    const canvas = this.opts.canvas
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprLimit))
    // false: three must not write inline styles; CSS sizes the canvas.
    this.renderer.setSize(width, height, false)
    this.aspect = width > 0 && height > 0 ? width / height : this.aspect
    this.camera.aspect = this.aspect
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  private fail(reason: FallbackReason): void {
    if (this.failed || this.disposed) return
    this.failed = true
    this.finishWarp()
    this.opts.onFallback(reason)
  }

  // --- events -----------------------------------------------------------------------

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.paused || this.warping) return
    const w = window.innerWidth || 1
    const h = window.innerHeight || 1
    this.targetX = Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1))
    this.targetY = Math.max(-1, Math.min(1, (e.clientY / h) * 2 - 1))
    this.invalidate()
  }

  private readonly onPointerOut = (e: PointerEvent): void => {
    if (e.relatedTarget || this.paused || this.warping) return
    this.targetX = 0
    this.targetY = 0
    this.invalidate()
  }

  private readonly onVisibility = (): void => {
    // Time across a hidden period is not a frame time (and must not teleport the field).
    this.lastFrameAt = 0
    this.monitor.reset()
    if (document.visibilityState === 'visible') this.invalidate()
  }

  private readonly onWindowResize = (): void => this.resize()

  private readonly onContextLost = (): void => this.fail('context-lost')
}
