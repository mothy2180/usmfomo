import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdleTimeout } from './idle.ts'

const MIN = 60_000

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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-05T06:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
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
    act(() => vi.advanceTimersByTime(29 * MIN))
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('does nothing while disabled (signed out)', () => {
    const onExpire = vi.fn()
    render(<Probe onExpire={onExpire} enabled={false} />)
    act(() => vi.advanceTimersByTime(60 * MIN))
    expect(onExpire).not.toHaveBeenCalled()
  })
})
