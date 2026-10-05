import { AccountsPage } from './accounts/AccountsPage.tsx'
import { ConsoleLayout } from './ConsoleLayout.tsx'
import { ModerationPage } from './moderation/ModerationPage.tsx'
import { NoticesPage } from './notices/NoticesPage.tsx'
import { OverviewPage } from './overview/OverviewPage.tsx'
import { useSection, type SectionId } from './sections.ts'

export function Console() {
  const section = useSection()
  return (
    <ConsoleLayout section={section}>
      {/* key: each section mounts fresh, so its heading takes focus. */}
      <SectionView key={section} section={section} />
    </ConsoleLayout>
  )
}

function SectionView({ section }: { section: SectionId }) {
  switch (section) {
    case 'overview':
      return <OverviewPage />
    case 'accounts':
      return <AccountsPage />
    case 'moderation':
      return <ModerationPage />
    case 'notices':
      return <NoticesPage />
  }
}
