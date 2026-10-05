import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = typeof import('./turnstile.ts')
let mod: Mod

beforeEach(async () => {
  vi.resetModules()
  delete window.turnstile
  document.head.innerHTML = ''
  mod = await import('./turnstile.ts')
})

afterEach(() => {
  delete window.turnstile
})

const fakeApi = () => ({ render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() })

describe('loadTurnstile', () => {
  it('adds one external script (explicit render, no inline code) and shares the promise', async () => {
    const a = mod.loadTurnstile()
    const b = mod.loadTurnstile()
    expect(a).toBe(b)
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.getAttribute('src')).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
    expect(scripts[0]!.textContent).toBe('')
    const api = fakeApi()
    window.turnstile = api
    scripts[0]!.dispatchEvent(new Event('load'))
    await expect(a).resolves.toBe(api)
  })

  it('resolves at once when the API is already there', async () => {
    const api = fakeApi()
    window.turnstile = api
    await expect(mod.loadTurnstile()).resolves.toBe(api)
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
  })

  it('rejects on a load error and lets a later call try again', async () => {
    const first = mod.loadTurnstile()
    document.head.querySelector('script')!.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('turnstile_load_failed')
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
    const second = mod.loadTurnstile()
    expect(second).not.toBe(first)
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })
})

describe('turnstileSize', () => {
  it('uses the compact widget below 300 px so the form reflows at 320 px', () => {
    expect(mod.turnstileSize(288)).toBe('compact')
    expect(mod.turnstileSize(300)).toBe('flexible')
    // Not laid out yet (width 0): keep the default.
    expect(mod.turnstileSize(0)).toBe('flexible')
  })
})
