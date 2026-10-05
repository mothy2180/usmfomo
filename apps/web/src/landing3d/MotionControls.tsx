import { useTranslation } from 'react-i18next'
import './landing3d.css'
import type { SceneStatus } from './types.ts'

type Props = {
  paused: boolean
  lite: boolean
  status: SceneStatus
  onTogglePaused: () => void
  onToggleLite: () => void
}

/**
 * The always-visible "Pause motion" and "Lite mode" toggles (WCAG 2.2.2), plus
 * the video's loading and tap-to-play notes. Toggle buttons keep a fixed name
 * and report their state with aria-pressed; the box before the label shows it.
 */
export function MotionControls({ paused, lite, status, onTogglePaused, onToggleLite }: Props) {
  const { t } = useTranslation('landing')
  const percent = status.progress === null ? null : Math.round(status.progress * 100)
  return (
    <div className="l3d-controls">
      <div className="l3d-buttons">
        <button type="button" className="l3d-toggle" aria-pressed={paused} onClick={onTogglePaused}>
          {t('pauseMotion')}
        </button>
        <button type="button" className="l3d-toggle" aria-pressed={lite} onClick={onToggleLite}>
          {t('liteMode')}
        </button>
      </div>
      {percent !== null ? <div className="l3d-status">{t('loading', { percent })}</div> : null}
      {status.blocked ? <div className="l3d-status">{t('tapToPlay')}</div> : null}
    </div>
  )
}
