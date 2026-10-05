// The video atlas is fetched in full (with progress) into a typed Blob and
// played from a Blob URL: Cloudflare Pages answers Range requests with 200,
// which iOS cannot stream. The Blob is cached for the page's lifetime, so
// coming Back to the landing page does not download it again. Blob URLs are
// revoked on pagehide and re-created on demand.

export type ProgressFn = (fraction: number) => void
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type FetchOptions = {
  /** Used for progress when the response has no Content-Length. */
  expectedBytes?: number
  onProgress?: ProgressFn
  signal?: AbortSignal
  fetchImpl?: FetchLike
}

/** Downloads `src` into a Blob of type video/mp4, reporting progress (0..1). */
export async function fetchVideoBlob(src: string, opts: FetchOptions = {}): Promise<Blob> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const res = await doFetch(src, { signal: opts.signal, credentials: 'same-origin' })
  if (!res.ok) throw new Error(`video atlas: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || opts.expectedBytes || 0
  const chunks: Uint8Array<ArrayBuffer>[] = []
  if (res.body) {
    const reader = res.body.getReader()
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      opts.onProgress?.(total > 0 ? Math.min(1, loaded / total) : 0)
    }
  } else {
    chunks.push(new Uint8Array(await res.arrayBuffer()))
  }
  opts.onProgress?.(1)
  // The type is required: Safari will not play a Blob URL without it.
  return new Blob(chunks, { type: 'video/mp4' })
}

type Entry = {
  promise: Promise<Blob>
  controller: AbortController
  blob: Blob | null
  url: string | null
  progress: number
  users: number
  listeners: Set<ProgressFn>
}

const cache = new Map<string, Entry>()

export type VideoLease = {
  /** Resolves with the cached Blob (at once if it is already here). */
  blob: Promise<Blob>
  /** Stop listening. An unfinished download nobody uses any more is aborted. */
  release: () => void
}

/** Shared, cached download of one video atlas. */
export function acquireVideo(src: string, opts: Omit<FetchOptions, 'signal'> = {}): VideoLease {
  let entry = cache.get(src)
  if (!entry) {
    const controller = new AbortController()
    const listeners = new Set<ProgressFn>()
    const created: Entry = {
      controller,
      listeners,
      blob: null,
      url: null,
      progress: 0,
      users: 0,
      promise: fetchVideoBlob(src, {
        expectedBytes: opts.expectedBytes,
        fetchImpl: opts.fetchImpl,
        signal: controller.signal,
        onProgress: (f) => {
          created.progress = f
          for (const fn of listeners) fn(f)
        },
      }).then(
        (blob) => {
          created.blob = blob
          return blob
        },
        (err: unknown) => {
          if (cache.get(src) === created) cache.delete(src)
          throw err
        },
      ),
    }
    // Consumers handle the error through their own lease; never report it as unhandled.
    created.promise.catch(() => {})
    cache.set(src, created)
    entry = created
  }
  const e = entry
  e.users++
  const onProgress = opts.onProgress
  if (onProgress) {
    e.listeners.add(onProgress)
    onProgress(e.blob ? 1 : e.progress)
  }
  let released = false
  return {
    blob: e.promise,
    release: () => {
      if (released) return
      released = true
      e.users--
      if (onProgress) e.listeners.delete(onProgress)
      if (e.users > 0 || e.blob) return
      // React StrictMode (and a quick unmount/mount) acquires again in the
      // same task, so only abort if nobody picked the download up by then.
      setTimeout(() => {
        if (e.users === 0 && !e.blob && cache.get(src) === e) {
          cache.delete(src)
          e.controller.abort()
        }
      }, 0)
    },
  }
}

/** A Blob URL for a downloaded atlas, created once and reused until pagehide. */
export function objectUrlFor(src: string, blob: Blob): string {
  const e = cache.get(src)
  if (!e || e.blob !== blob) throw new Error('video atlas: not in the cache')
  e.url ??= URL.createObjectURL(blob)
  return e.url
}

/** Revokes every Blob URL; the Blobs stay cached for a Back/forward restore. */
export function revokeVideoUrls(): void {
  for (const e of cache.values()) {
    if (e.url) URL.revokeObjectURL(e.url)
    e.url = null
  }
}

/** Tests only: forget every cached download. */
export function clearVideoCache(): void {
  revokeVideoUrls()
  for (const e of cache.values()) e.controller.abort()
  cache.clear()
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', revokeVideoUrls)
