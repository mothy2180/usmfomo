import { googleCalendarUrl } from '@usmfomo/shared/ics'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui.tsx'
import { calendarEventFor, downloadIcs } from './calendar.ts'

type Props = {
  post: { id: string; title: string; starts_at: string; ends_at: string; venue: string; description: string | null }
  pageUrl: string
}

/** "Hold the date": an .ics file for any calendar app, plus Google Calendar. */
export function CalendarActions({ post, pageUrl }: Props) {
  const { t } = useTranslation('dashboard')
  const ev = calendarEventFor(post, pageUrl)
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => downloadIcs(ev)}>
        {t('event.addToCalendar')}
      </Button>
      <a
        href={googleCalendarUrl(ev)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-text no-underline transition hover:border-sky"
      >
        {t('event.googleCalendar')}
        <span className="sr-only"> {t('event.newTab')}</span>
        <span aria-hidden="true">↗</span>
      </a>
    </div>
  )
}
