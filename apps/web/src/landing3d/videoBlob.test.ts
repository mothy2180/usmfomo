import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireVideo, clearVideoCache, fetchVideoBlob, objectUrlFor, revokeVideoUrls, type FetchLike } from './videoBlob.ts'

/** A fetch that streams `chunks` (with or without a Content-Length). */
function streamingFetch(chunks: number[], opts: { length?: boolean; status?: number } = {}) {
  const total = chunks.reduce((a, b) => a + b, 0)
  return vi.fn(async (_input: string, init?: RequestInit) => {
    const signal = init?.signal
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = chunks.shift()
        if (signal?.aborted) {
          controller.error(new DOMException('aborted', 'AbortError'))
          return
        }
        if (next === undefined) controller.close()
        else controller.enqueue(new Uint8Array(next))
      },
    })
    const headers = new Headers(opts.length === false ? {} : { 'content-length': String(total) })
    const status = opts.status ?? 200
    return { ok: status < 400, status, headers, body } as unknown as Response
  })
}

describe('fetchVideoBlob', () => {
  it('returns a Blob typed video/mp4 (Safari needs the type) with every byte', async () => {
    const blob = await fetchVideoBlob('/a.mp4', { fetchImpl: streamingFetch([1000, 2000, 500]) })
    expect(blob.type).toBe('video/mp4')
    expect(blob.size).toBe(3500)
  })

  it('reports progress up to 1, using expectedBytes when there is no Content-Length', async () => {
    const seen: number[] = []
    await fetchVideoBlob('/a.mp4', { fetchImpl: streamingFetch([100, 100, 200], { length: false }), expectedBytes: 400, onProgress: (f) => seen.push(f) })
    expect(seen).toEqual([0.25, 0.5, 1, 1])
  })

  it('fails on an HTTP error', async () => {
    await expect(fetchVideoBlob('/a.mp4', { fetchImpl: streamingFetch([10], { status: 404 }) })).rejects.toThrow(/404/)
  })
})

describe('acquireVideo (cached for the page)', () => {
  // jsdom has no Blob URLs.
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  beforeEach(() => {
    let n = 0
    URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    clearVideoCache()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.useRealTimers()
  })

  it('downloads once for every lease and keeps the Blob after release (Back reuses it)', async () => {
    const fetchImpl = streamingFetch([10, 10])
    const a = acquireVideo('/v.mp4', { fetchImpl })
    const b = acquireVideo('/v.mp4', { fetchImpl })
    const [blobA, blobB] = await Promise.all([a.blob, b.blob])
    expect(blobA).toBe(blobB)
    a.release()
    b.release()
    const c = acquireVideo('/v.mp4', { fetchImpl })
    await expect(c.blob).resolves.toBe(blobA)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('tells a late subscriber the current progress', async () => {
    const fetchImpl = streamingFetch([10])
    const first = acquireVideo('/v.mp4', { fetchImpl })
    await first.blob
    const seen: number[] = []
    acquireVideo('/v.mp4', { fetchImpl, onProgress: (f) => seen.push(f) })
    expect(seen).toEqual([1])
  })

  it('survives a StrictMode release/acquire in the same task', async () => {
    vi.useFakeTimers()
    const fetchImpl = streamingFetch([10, 10])
    const first = acquireVideo('/v.mp4', { fetchImpl })
    first.release()
    const second = acquireVideo('/v.mp4', { fetchImpl })
    await vi.runAllTimersAsync()
    await expect(second.blob).resolves.toBeInstanceOf(Blob)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('aborts an unfinished download nobody uses any more', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchImpl: FetchLike = vi.fn((_input: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const lease = acquireVideo('/slow.mp4', { fetchImpl })
    lease.release()
    await vi.runAllTimersAsync()
    expect(signal?.aborted).toBe(true)
    // A later visit starts a fresh download.
    acquireVideo('/slow.mp4', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('makes one Blob URL per atlas and keeps it across pagehide (back/forward cache)', async () => {
    const lease = acquireVideo('/v.mp4', { fetchImpl: streamingFetch([10]) })
    const blob = await lease.blob
    const url = objectUrlFor('/v.mp4', blob)
    expect(objectUrlFor('/v.mp4', blob)).toBe(url)
    window.dispatchEvent(new Event('pagehide'))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(objectUrlFor('/v.mp4', blob)).toBe(url)
    revokeVideoUrls()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })
})
