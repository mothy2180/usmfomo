import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  needsWebGL2Probe,
  prefersReducedMotion,
  probeWebGL2,
  resolveMotion,
  saveDataOn,
  sceneGate,
  shouldWarp,
  type GateInput,
} from './gating.ts'
import { LITE_KEY, MOTION_KEY, readStoredPrefs, writeLitePref, writeMotionPref } from './prefs.ts'

const none = { motion: null, lite: null } as const

describe('resolveMotion', () => {
  it('plays and loads by default', () => {
    expect(resolveMotion(none, { reducedMotion: false, saveData: false })).toEqual({ paused: false, lite: false })
  })

  it('starts paused with reduced motion and in lite mode with Data Saver', () => {
    expect(resolveMotion(none, { reducedMotion: true, saveData: false })).toEqual({ paused: true, lite: false })
    expect(resolveMotion(none, { reducedMotion: false, saveData: true })).toEqual({ paused: false, lite: true })
  })

  it('lets the visitor’s remembered choice win', () => {
    expect(resolveMotion({ motion: 'playing', lite: 'off' }, { reducedMotion: true, saveData: true })).toEqual({ paused: false, lite: false })
    expect(resolveMotion({ motion: 'paused', lite: 'on' }, { reducedMotion: false, saveData: false })).toEqual({ paused: true, lite: true })
  })
})

describe('sceneGate', () => {
  const base: GateInput = { idle: true, failed: false, lite: false, paused: false, mounted: false, webgl2: true }

  it('mounts when idle with WebGL2 and nothing against it', () => {
    expect(sceneGate(base)).toBe('mount')
  })

  it('never mounts in lite mode, after a failure or without WebGL2', () => {
    expect(sceneGate({ ...base, lite: true })).toBe('lite')
    expect(sceneGate({ ...base, lite: true, mounted: true })).toBe('lite')
    expect(sceneGate({ ...base, failed: true })).toBe('failed')
    expect(sceneGate({ ...base, webgl2: false })).toBe('no-webgl2')
  })

  it('does not load a paused page, but keeps a running scene mounted (frozen)', () => {
    expect(sceneGate({ ...base, paused: true })).toBe('paused')
    expect(sceneGate({ ...base, paused: true, mounted: true })).toBe('mount')
  })

  it('waits for idle and for the probe', () => {
    expect(sceneGate({ ...base, idle: false })).toBe('wait')
    expect(sceneGate({ ...base, webgl2: null })).toBe('wait')
  })

  it('only probes WebGL2 when the scene could mount', () => {
    const rest: Omit<GateInput, 'webgl2'> = { idle: true, failed: false, lite: false, paused: false, mounted: false }
    expect(needsWebGL2Probe(rest)).toBe(true)
    expect(needsWebGL2Probe({ ...rest, lite: true })).toBe(false)
    expect(needsWebGL2Probe({ ...rest, paused: true })).toBe(false)
    expect(needsWebGL2Probe({ ...rest, idle: false })).toBe(false)
    expect(needsWebGL2Probe({ ...rest, failed: true })).toBe(false)
  })
})

describe('shouldWarp', () => {
  const ok = { plainClick: true, reducedMotion: false, paused: false, sceneReady: true, hidden: false }
  it('animates only a plain click on a ready, moving scene', () => {
    expect(shouldWarp(ok)).toBe(true)
    expect(shouldWarp({ ...ok, plainClick: false })).toBe(false)
    expect(shouldWarp({ ...ok, reducedMotion: true })).toBe(false)
    expect(shouldWarp({ ...ok, paused: true })).toBe(false)
    expect(shouldWarp({ ...ok, sceneReady: false })).toBe(false)
    expect(shouldWarp({ ...ok, hidden: true })).toBe(false)
  })
})

describe('probes', () => {
  afterEach(() => vi.restoreAllMocks())

  const fakeDoc = (getContext: (kind: string, attrs?: WebGLContextAttributes) => unknown) =>
    ({ createElement: () => ({ getContext }) }) as unknown as Document

  it('asks for WebGL2 without a major performance caveat and frees the test context', () => {
    const loseContext = vi.fn()
    const getContext = vi.fn((_kind: string, _attrs?: WebGLContextAttributes) => ({
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
    }))
    expect(probeWebGL2(fakeDoc(getContext))).toBe(true)
    expect(getContext).toHaveBeenCalledWith('webgl2', expect.objectContaining({ failIfMajorPerformanceCaveat: true }))
    expect(loseContext).toHaveBeenCalledOnce()
  })

  it('reports no WebGL2 when the context is refused or creation throws', () => {
    expect(probeWebGL2(fakeDoc(() => null))).toBe(false)
    expect(
      probeWebGL2(
        fakeDoc(() => {
          throw new Error('blocked')
        }),
      ),
    ).toBe(false)
  })

  it('reads reduced motion and Data Saver defensively', () => {
    expect(prefersReducedMotion({ matchMedia: undefined } as unknown as Window)).toBe(false)
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) } as unknown as Window)).toBe(true)
    expect(saveDataOn({} as Navigator)).toBe(false)
    expect(saveDataOn({ connection: { saveData: true } } as unknown as Navigator)).toBe(true)
  })
})

describe('stored prefs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('round-trips through localStorage and ignores junk', () => {
    expect(readStoredPrefs()).toEqual(none)
    writeMotionPref('paused')
    writeLitePref('on')
    expect(readStoredPrefs()).toEqual({ motion: 'paused', lite: 'on' })
    window.localStorage.setItem(MOTION_KEY, 'maybe')
    window.localStorage.setItem(LITE_KEY, '1')
    expect(readStoredPrefs()).toEqual(none)
  })

  it('falls back to the defaults when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => writeMotionPref('paused')).not.toThrow()
    expect(readStoredPrefs()).toEqual(none)
  })
})
