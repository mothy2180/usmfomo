import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnstileRenderOptions } from './turnstile.ts'

vi.mock('../env.ts', () => ({ TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }))

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

const fakeApi = () => ({
  render: vi.fn((_el: HTMLElement | string, _options: TurnstileRenderOptions): string | null | undefined => 'w1'),
  reset: vi.fn((_id?: string) => {}),
  remove: vi.fn((_id?: string) => {}),
  getResponse: vi.fn((_id?: string): string | undefined => undefined),
  isExpired: vi.fn((_id?: string) => false),
})

describe('loadTurnstile', () => {
  it('adds exactly one external script (src only, explicit render) and shares the promise', async () => {
    const a = mod.loadTurnstile()
    const b = mod.loadTurnstile()
    expect(a).toBe(b)
    const scripts = document.head.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    const script = scripts[0]!
    expect(script.getAttribute('src')).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
    expect(script.textContent).toBe('')
    const api = fakeApi()
    window.turnstile = api
    script.dispatchEvent(new Event('load'))
    await expect(a).resolves.toBe(api)
  })

  it('resolves at once when the API is already present', async () => {
    const api = fakeApi()
    window.turnstile = api
    await expect(mod.loadTurnstile()).resolves.toBe(api)
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
  })

  it('rejects on a network error and allows a fresh retry', async () => {
    const first = mod.loadTurnstile()
    document.head.querySelector('script')!.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('turnstile_unavailable')
    expect(document.head.querySelectorAll('script')).toHaveLength(0)
    const second = mod.loadTurnstile()
    expect(second).not.toBe(first)
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })
})

describe('widget options', () => {
  it('uses the site key, the login action, the dark theme and the page language', () => {
    const events = { onToken: vi.fn(), onExpire: vi.fn(), onError: vi.fn() }
    const o = mod.widgetOptions('login', 'ms', 400, events)
    expect(o).toMatchObject({
      sitekey: '1x00000000000000000000AA',
      action: 'login',
      theme: 'dark',
      language: 'ms',
      size: 'flexible',
      'response-field': false,
    })
    o.callback?.('tok')
    expect(events.onToken).toHaveBeenCalledWith('tok')
    o['expired-callback']?.('tok')
    o['timeout-callback']?.()
    expect(events.onExpire).toHaveBeenCalledTimes(2)
    // Returning true marks the error as handled (Turnstile would throw otherwise).
    expect(o['error-callback']?.('110200')).toBe(true)
    expect(events.onError).toHaveBeenCalledWith('110200')
  })

  it('switches to the compact widget below 300 px so the page reflows at 320 px', () => {
    expect(mod.widgetSize(288)).toBe('compact')
    expect(mod.widgetSize(300)).toBe('flexible')
  })
})

describe('useTurnstile', () => {
  async function setup() {
    const { act, renderHook } = await import('@testing-library/react')
    const api = fakeApi()
    window.turnstile = api
    const hook = renderHook(({ lang }: { lang: 'en' | 'ms' }) => mod.useTurnstile('login', lang), { initialProps: { lang: 'en' } })
    // The callback ref, as React would call it; loadTurnstile resolves on a microtask.
    await act(async () => hook.result.current.attach(document.createElement('div')))
    const opts = () => api.render.mock.calls.at(-1)?.[1]
    return { act, api, hook, opts }
  }

  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
  })

  it('renders into the attached element and exposes the token', async () => {
    const { act, api, hook, opts } = await setup()
    expect(api.render).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toMatchObject({ token: null, status: 'ready' })
    await act(async () => opts()?.callback?.('tok-1'))
    expect(hook.result.current).toMatchObject({ token: 'tok-1', status: 'solved' })
  })

  it('drops a used token on reset (tokens are single-use)', async () => {
    const { act, api, hook, opts } = await setup()
    await act(async () => opts()?.callback?.('tok-1'))
    await act(async () => hook.result.current.reset())
    expect(api.reset).toHaveBeenCalledWith('w1')
    expect(hook.result.current).toMatchObject({ token: null, status: 'ready' })
  })

  it('forgets an expired token and reports errors', async () => {
    const { act, hook, opts } = await setup()
    await act(async () => opts()?.callback?.('tok-1'))
    await act(async () => opts()?.['expired-callback']?.('tok-1'))
    expect(hook.result.current.token).toBeNull()
    await act(async () => void opts()?.['error-callback']?.('300030'))
    expect(hook.result.current).toMatchObject({ token: null, status: 'error' })
  })

  it('renders a fresh widget on retry or a language change, removing the old one', async () => {
    const { act, api, hook } = await setup()
    await act(async () => hook.result.current.retry())
    expect(api.remove).toHaveBeenCalledWith('w1')
    expect(api.render).toHaveBeenCalledTimes(2)
    await act(async () => hook.rerender({ lang: 'ms' }))
    expect(api.render).toHaveBeenCalledTimes(3)
    expect(api.render.mock.calls.at(-1)?.[1]).toMatchObject({ language: 'ms' })
  })

  it('removes the widget on unmount', async () => {
    const { api, hook } = await setup()
    hook.unmount()
    expect(api.remove).toHaveBeenCalledWith('w1')
  })
})
