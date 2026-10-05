import { beforeEach, describe, expect, it } from 'vitest'
import { dismissKey, isDismissed, NOTICE_KEY_PREFIX, pruneDismissed, rememberDismissed } from './noticeStorage.ts'

const notice = { id: 'e077e063-3a0c-4da7-9a7c-abbb26f11a9e', updated_at: '2026-10-05T02:19:37.596554+00:00' }

/** A Storage whose every call throws, like Safari with storage blocked. */
const throwingStorage = (): Storage =>
  new Proxy({} as Storage, {
    get() {
      throw new DOMException('blocked', 'SecurityError')
    },
  })

describe('notice dismissal storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('keys a dismissal by notice id and updated_at', () => {
    expect(dismissKey(notice)).toBe(`${NOTICE_KEY_PREFIX}${notice.id}:${notice.updated_at}`)
  })

  it('remembers a dismissed notice in localStorage', () => {
    expect(isDismissed(notice)).toBe(false)
    rememberDismissed(notice)
    expect(isDismissed(notice)).toBe(true)
    expect(window.localStorage.getItem(dismissKey(notice))).toBe('1')
  })

  it('shows an edited notice again (new updated_at)', () => {
    rememberDismissed(notice)
    expect(isDismissed({ ...notice, updated_at: '2026-10-06T08:00:00+00:00' })).toBe(false)
  })

  it('never throws when storage is blocked or missing', () => {
    expect(() => rememberDismissed(notice, throwingStorage())).not.toThrow()
    expect(isDismissed(notice, throwingStorage())).toBe(false)
    expect(() => pruneDismissed([notice], throwingStorage())).not.toThrow()
    expect(isDismissed(notice, null)).toBe(false)
    expect(() => rememberDismissed(notice, null)).not.toThrow()
  })

  it('prunes dismissals of notices that are gone, and nothing else', () => {
    const old = { id: '00000000-0000-4000-8000-000000000001', updated_at: '2026-09-01T00:00:00Z' }
    rememberDismissed(notice)
    rememberDismissed(old)
    window.localStorage.setItem('usmfomo.lang', 'ms')
    pruneDismissed([notice])
    expect(isDismissed(notice)).toBe(true)
    expect(isDismissed(old)).toBe(false)
    expect(window.localStorage.getItem('usmfomo.lang')).toBe('ms')
  })

  it('does not prune on an empty list (public reads may be switched off)', () => {
    rememberDismissed(notice)
    pruneDismissed([])
    expect(isDismissed(notice)).toBe(true)
  })
})
