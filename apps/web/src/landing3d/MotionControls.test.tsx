import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n.ts'
import { MotionControls } from './MotionControls.tsx'
import { NO_STATUS } from './types.ts'

describe('MotionControls', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(cleanup)

  it('renders two keyboard-reachable toggle buttons that report their state', () => {
    const onTogglePaused = vi.fn()
    const onToggleLite = vi.fn()
    const { rerender } = render(
      <MotionControls paused={false} lite={false} status={NO_STATUS} onTogglePaused={onTogglePaused} onToggleLite={onToggleLite} />,
    )
    const pause = screen.getByRole('button', { name: 'Pause motion' })
    const lite = screen.getByRole('button', { name: 'Lite mode' })
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    expect(lite.getAttribute('aria-pressed')).toBe('false')
    expect(pause.getAttribute('type')).toBe('button')
    expect(pause.tabIndex).toBe(0)

    fireEvent.click(pause)
    fireEvent.click(lite)
    expect(onTogglePaused).toHaveBeenCalledOnce()
    expect(onToggleLite).toHaveBeenCalledOnce()

    rerender(<MotionControls paused lite status={NO_STATUS} onTogglePaused={onTogglePaused} onToggleLite={onToggleLite} />)
    // A toggle keeps its name; aria-pressed carries the state.
    expect(screen.getByRole('button', { name: 'Pause motion' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Lite mode' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the download progress and the tap-to-play note', () => {
    const noop = () => {}
    const { rerender } = render(
      <MotionControls paused={false} lite={false} status={{ progress: 0.426, blocked: false }} onTogglePaused={noop} onToggleLite={noop} />,
    )
    expect(screen.getByText('Loading the glass… 43%')).toBeTruthy()
    rerender(<MotionControls paused={false} lite={false} status={{ progress: null, blocked: true }} onTogglePaused={noop} onToggleLite={noop} />)
    expect(screen.queryByText(/Loading the glass/)).toBeNull()
    expect(screen.getByText('Tap anywhere to start the clips')).toBeTruthy()
  })

  it('is translated into Bahasa Malaysia', async () => {
    await i18n.changeLanguage('ms')
    const noop = () => {}
    render(<MotionControls paused={false} lite status={NO_STATUS} onTogglePaused={noop} onToggleLite={noop} />)
    expect(screen.getByRole('button', { name: 'Jeda gerakan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mod ringan' })).toBeTruthy()
    await i18n.changeLanguage('en')
  })
})
