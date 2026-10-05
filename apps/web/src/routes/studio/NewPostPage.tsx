import { useTranslation } from 'react-i18next'
import { ButtonLink } from '../../components/ui.tsx'
import { currentLang } from '../../lib/i18n.ts'
import type { OkStatus } from '../../lib/session.ts'
import { PostForm } from '../../features/studio/PostForm.tsx'
import { newPostBlock, newPostBlockText } from '../../features/studio/statusBar.ts'
import { StatusBar } from '../../features/studio/StatusBar.tsx'
import { StudioFrame } from '../../features/studio/StudioFrame.tsx'
import { StudioGuard } from '../../features/studio/StudioGuard.tsx'
import { useLatch } from '../../features/studio/useLatch.ts'
import { useNow } from '../../features/studio/useNow.ts'

/** /studio/new */
export function NewPostPage() {
  const { t } = useTranslation('studio')
  return <StudioGuard title={t('form.newTitle')}>{({ status }) => <NewPostContent status={status} />}</StudioGuard>
}

function NewPostContent({ status }: { status: OkStatus }) {
  const { t } = useTranslation('studio')
  const now = useNow()
  const block = newPostBlock(status)
  // Once open, the form stays (and shows "Published") even when the post it
  // just created used up the last slot.
  const showForm = useLatch(block === null)
  const blockText = newPostBlockText(t, status, now, currentLang())
  const reason = block === 'paused' ? `${blockText ?? ''} ${t('form.pausedNoForm')}` : blockText

  return (
    <StudioFrame title={t('form.newTitle')} orgName={status.org.name}>
      <div className="flex max-w-2xl flex-col gap-6">
        <StatusBar status={status} />
        {!showForm && reason ? (
          <div className="flex flex-col items-start gap-4">
            <p className="m-0 rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm font-semibold">{reason}</p>
            <ButtonLink to="/studio">{t('nav.backToStudio')}</ButtonLink>
          </div>
        ) : (
          <PostForm org={status.org} postingEnabled={status.posting_enabled} />
        )}
      </div>
    </StudioFrame>
  )
}
