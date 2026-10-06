import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_SAVE_MS,
  formatCountdown,
  IDLE_LIMIT_MS,
  IDLE_WARNING_MS,
  idleExpired,
  idlePhase,
  readLastActivity,
  saveLastActivity,
  useIdleTimeout,
} from './idle.ts'

const MIN = 60_000
const T0 = new Date('2026-10-05T06:00:00Z').getTime()

function Probe({ onExpire, enabled = true }: { onExpire: () => void; enabled?: boolean }) {
  const { state, stayActive } = useIdleTimeout({ enabled, onExpire })
  return (
    <div>
      <p>{state.phase === 'warning' ? `warning ${state.remainingMs}` : 'active'}</p>
      <button type="button" onClick={stayActive}>
        stay
      </button>
    </div>
  )
}

const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('idle limits', () => {
  it('signs out after 30 minutes and warns 2 minutes before', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * MIN)
    expect(idlePhase(0)).toBe('active')
    expect(idlePhase(IDLE_LIMIT_MS - IDLE_WARNING_MS - 1)).toBe('active')
    expect(idlePhase(IDLE_LIMIT_MS - IDLE_WARNING_MS)).toBe('warning')
    expect(idlePhase(IDLE_LIMIT_MS - 1)).toBe('warning')
    expect(idlePhase(IDLE_LIMIT_MS)).toBe('expired')
  })

  it('formats the countdown', () => {
    expect(formatCountdown(120_000)).toBe('2:00')
    expect(formatCountdown(65_000)).toBe('1:05')
    expect(formatCountdown(400)).toBe('0:01')
    expect(formatCountdown(-5)).toBe('0:00')
  })

  it('treats a tab without a known last input as idle for too long', () => {
    expect(idleExpired(null, T0)).toBe(true)
    expect(idleExpired(T0 - IDLE_LIMIT_MS, T0)).toBe(true)
    expect(idleExpired(T0 - IDLE_LIMIT_MS + 1, T0)).toBe(false)
    expect(idleExpired(T0, T0)).toBe(false)
  })
})

describe('last input in sessionStorage', () => {
  it('is kept per tab and read back', () => {
    expect(readLastActivity()).toBeNull()
    saveLastActivity(T0 - 5 * MIN)
    expect(readLastActivity()).toBe(T0 - 5 * MIN)
    window.sessionStorage.setItem('usmfomo.studio.lastActivity', 'garbage')
    expect(readLastActivity()).toBeNull()
  })

  it('never throws when storage is blocked (and then counts as unknown)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => saveLastActivity()).not.toThrow()
    expect(readLastActivity()).toBeNull()
  })
})

describe('useIdleTimeout', () => {
  it('warns 2 minutes before and expires after 30 minutes without input', () => {
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(27 * MIN))
    expect(screen.getByText('active')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1 * MIN + 1000))
    expect(screen.getByText(/^warning /)).toBeTruthy()
    expect(onExpire).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(2 * MIN))
    expect(onExpire).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(5 * MIN))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('counts key presses as activity', () => {
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(25 * MIN))
    act(() => key())
    act(() => vi.advanceTimersByTime(25 * MIN))
    expect(onExpire).not.toHaveBeenCalled()
    expect(screen.getByText('active')).toBeTruthy()
    act(() => vi.advanceTimersByTime(5 * MIN + 1000))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('"Stay signed in" ends the warning', () => {
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} />)
    act(() => vi.advanceTimersByTime(29 * MIN))
    expect(screen.getByText(/^warning /)).toBeTruthy()
    act(() => screen.getByRole('button', { name: 'stay' }).click())
    expect(screen.getByText('active')).toBeTruthy()
    expect(readLastActivity()).toBe(Date.now())
    act(() => vi.advanceTimersByTime(29 * MIN))
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('does nothing while disabled (signed out)', () => {
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} enabled={false} />)
    act(() => vi.advanceTimersByTime(60 * MIN))
    expect(onExpire).not.toHaveBeenCalled()
    expect(readLastActivity()).toBeNull()
  })

  it('saves input for the restore check, at most every 10 seconds', () => {
    render(<Probe onExpire={() => {}} />)
    expect(readLastActivity()).toBe(T0)
    act(() => vi.advanceTimersByTime(ACTIVITY_SAVE_MS / 2))
    act(() => key())
    expect(readLastActivity()).toBe(T0)
    act(() => vi.advanceTimersByTime(ACTIVITY_SAVE_MS))
    act(() => key())
    expect(readLastActivity()).toBe(T0 + ACTIVITY_SAVE_MS * 1.5)
  })

  it('carries on from the last input saved in this tab (another page, or a restored tab)', () => {
    saveLastActivity(T0 - 29 * MIN)
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} />)
    expect(screen.getByText('warning 60000')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1 * MIN))
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('expires at once when the saved input is already past the limit', () => {
    saveLastActivity(T0 - 31 * MIN)
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} />)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })
})
