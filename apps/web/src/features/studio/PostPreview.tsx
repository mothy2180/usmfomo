import { formatEventRange } from '@usmfomo/shared/time'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { Badge } from '../../components/ui.tsx'
import { currentLang } from '../../lib/i18n.ts'
import { BlobImage } from './BlobImage.tsx'
import type { ValidPost } from './postForm.ts'

/** The poster to show: a new (not yet uploaded) file, the current one, or none. */
export type PreviewPoster = { blob: Blob } | { url: string } | null

const POSTER_CLASS = 'block max-h-[32rem] w-full bg-ink object-contain'
const QR_CLASS = 'block h-40 w-40 max-w-full self-start rounded-lg bg-white object-contain p-2'

/** How the post will look to students (text exactly as typed, MYT times). */
export function PostPreview({
  data,
  orgName,
  poster,
  qr = null,
  cancelled,
}: {
  data: ValidPost
  orgName: string
  poster: PreviewPoster
  /** The registration QR image, shown above the link like on the event page. */
  qr?: PreviewPoster
  cancelled: boolean
}) {
  const { t } = useTranslation('studio')
  const alt = t('posts.posterAlt', { title: data.title })
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      {poster && 'blob' in poster ? <BlobImage blob={poster.blob} alt={alt} className={POSTER_CLASS} /> : null}
      {poster && 'url' in poster ? <img src={poster.url} alt={alt} className={POSTER_CLASS} /> : null}
      <div className="flex flex-col gap-2 p-4">
        <p className="m-0 text-sm break-words text-muted">{orgName}</p>
        <h3 className="m-0 text-xl font-bold break-words">{data.title}</h3>
        {cancelled ? (
          <p className="m-0">
            <Badge tone="danger">{t('common:time.cancelled')}</Badge>
          </p>
        ) : null}
        <p className="m-0">{formatEventRange(data.starts_at, data.ends_at, currentLang())}</p>
        <p className="m-0 break-words">
          {data.venue} · {t(`common:campus.${data.campus}`)}
        </p>
        {data.mycsd ? <p className="m-0 font-semibold text-ok">{t('dashboard:card.mycsd')}</p> : null}
        {data.description ? <p className="m-0 break-words whitespace-pre-line text-muted">{data.description}</p> : null}
        {qr && 'blob' in qr ? <BlobImage blob={qr.blob} alt={t('qr.previewAlt')} className={QR_CLASS} /> : null}
        {qr && 'url' in qr ? <img src={qr.url} alt={t('qr.previewAlt')} className={QR_CLASS} /> : null}
        {data.link_url ? (
          <p className="m-0">
            <ExternalLink href={data.link_url}>{t('form.linkText')}</ExternalLink>
          </p>
        ) : null}
        {data.contact_email ? <p className="m-0 break-words">{t('form.emailText', { email: data.contact_email })}</p> : null}
      </div>
    </article>
  )
}
