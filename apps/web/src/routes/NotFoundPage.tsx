import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell.tsx'
import { ButtonLink } from '../components/ui.tsx'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <AppShell>
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="text-muted">{t('notFound.body')}</p>
      <ButtonLink to="/dashboard" variant="primary">
        {t('notFound.back')}
      </ButtonLink>
    </AppShell>
  )
}
