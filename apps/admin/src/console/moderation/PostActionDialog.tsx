import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { ConfirmBody } from '../../components/ConfirmDialog.tsx'
import { Dialog } from '../../components/Dialog.tsx'
import { Button, Callout } from '../../components/ui.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { adminApi } from '../../lib/db.ts'
import { plural } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { dropCachedPost, patchCachedPost, qk, setPostHidden, type ModPost } from '../../lib/queries.ts'

export type PostAction = 'hide' | 'unhide' | 'remove_image' | 'delete'

type Copy = { title: string; effect: ReactNode; confirmLabel: string; tone: 'danger' | 'primary' }

/** What happened: the announcement, and how many poster files Storage refused to delete. */
type Outcome = { message: string; failedFiles: number }

const CACHE_NOTE =
  'Copies already cached can stay reachable for up to 6 hours at the edge and 1 hour in browsers; the free plan has no cache purge.'

function copyFor(action: PostAction, post: ModPost): Copy {
  const org = post.org?.name ?? 'The organisation'
  switch (action) {
    case 'hide':
      return {
        title: `Hide “${post.title}”?`,
        effect: (
          <>
            <p className="m-0">
              It disappears from the public site at once: lists, search, its event page and the organisation page.
            </p>
            <p className="m-0">
              {org} still sees it in Studio, marked as hidden by the usmfomo admin, and can’t unhide it. You can unhide it
              here until it ends.
            </p>
            <p className="m-0">The poster file stays. If the poster itself is the problem, also remove the image.</p>
          </>
        ),
        confirmLabel: 'Hide post',
        tone: 'danger',
      }
    case 'unhide':
      return {
        title: `Show “${post.title}” again?`,
        effect: <p className="m-0">It is public again until it ends.</p>,
        confirmLabel: 'Unhide post',
        tone: 'primary',
      }
    case 'remove_image':
      return {
        title: `Remove the poster of “${post.title}”?`,
        effect: (
          <>
            <p className="m-0">The poster and its thumbnail are deleted now. The post itself stays, without an image.</p>
            <p className="m-0">{CACHE_NOTE}</p>
          </>
        ),
        confirmLabel: 'Remove image',
        tone: 'danger',
      }
    case 'delete':
      return {
        title: `Delete “${post.title}”?`,
        effect: (
          <>
            <p className="m-0">The post and its poster files are deleted now. Neither you nor {org} can undo this.</p>
            <p className="m-0">{CACHE_NOTE}</p>
          </>
        ),
        confirmLabel: 'Delete post',
        tone: 'danger',
      }
  }
}

export function PostActionDialog({ post, action, onClose }: { post: ModPost; action: PostAction; onClose: () => void }) {
  const queryClient = useQueryClient()
  const announce = useAnnounce()
  const descId = useId()
  // Files Storage refused to delete: shown instead of a success message.
  const [leftover, setLeftover] = useState(0)
  const copy = copyFor(action, post)

  const mutation = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      switch (action) {
        case 'hide':
        case 'unhide': {
          const row = await setPostHidden(post.id, action === 'hide')
          patchCachedPost(queryClient, post.id, { hidden_at: row.hidden_at, updated_at: row.updated_at })
          const message = action === 'hide' ? `“${post.title}” hidden.` : `“${post.title}” is public again.`
          return { message, failedFiles: 0 }
        }
        case 'remove_image': {
          const { removedFiles, failedFiles } = await adminApi.removePostImage(post.id)
          patchCachedPost(queryClient, post.id, { poster_path: null, thumb_path: null })
          const message = removedFiles ? `Image removed (${plural(removedFiles, 'file')} deleted).` : 'Image removed.'
          return { message, failedFiles }
        }
        case 'delete': {
          const { removedFiles, failedFiles } = await adminApi.deletePost(post.id)
          dropCachedPost(queryClient, post.id)
          const message = removedFiles ? `Post deleted, with ${plural(removedFiles, 'poster file')}.` : 'Post deleted.'
          return { message, failedFiles }
        }
      }
    },
    onSuccess: ({ message, failedFiles }) => {
      void queryClient.invalidateQueries({ queryKey: qk.status })
      if (failedFiles > 0) return setLeftover(failedFiles)
      onClose()
      announce(message)
    },
  })

  // One dialog for both steps: when the warning replaces the confirm step,
  // focus moves to its new title, so it is read out.
  return (
    <Dialog
      open
      title={leftover ? leftoverTitle(action, leftover) : copy.title}
      onClose={onClose}
      focusKey={leftover ? 'leftover' : 'confirm'}
      preventEscape={mutation.isPending}
      describedBy={descId}
    >
      {leftover ? (
        <LeftoverFiles descId={descId} count={leftover} paths={[post.poster_path, post.thumb_path]} onClose={onClose} />
      ) : (
        <ConfirmBody
          descId={descId}
          confirmLabel={copy.confirmLabel}
          tone={copy.tone}
          busy={mutation.isPending}
          error={mutation.isError ? errorMessage(mutation.error) : null}
          onConfirm={() => mutation.mutate()}
          onCancel={onClose}
        >
          {copy.effect}
        </ConfirmBody>
      )}
    </Dialog>
  )
}

function leftoverTitle(action: PostAction, count: number): string {
  const files = count === 1 ? 'a file is' : `${count} files are`
  return action === 'delete' ? `Post deleted, but ${files} still public` : `Image removed, but ${files} still public`
}

/** The action happened, but Storage kept some files: say so instead of "done". */
function LeftoverFiles({
  descId,
  count,
  paths,
  onClose,
}: {
  descId: string
  count: number
  paths: ReadonlyArray<string | null>
  onClose: () => void
}) {
  const known = paths.filter((p): p is string => Boolean(p))
  const one = count === 1
  return (
    <div className="flex flex-col gap-4">
      <div id={descId} className="flex flex-col gap-2 text-sm">
        <Callout tone="warn">
          <p className="m-0">
            Storage couldn’t delete {plural(count, 'poster file')}.{' '}
            {one ? 'It stays public at its address' : 'They stay public at their addresses'} until the daily clean-up
            deletes {one ? 'it' : 'them'}, which can take up to two days.
          </p>
          {known.length ? (
            <>
              <p className="m-0">
                To remove the files sooner, delete them in the Supabase dashboard (Storage → posters). This post’s files
                were:
              </p>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {known.map((p) => (
                  <li key={p} className="break-all font-mono text-xs">
                    {p}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Callout>
      </div>
      <Button variant="primary" onClick={onClose} className="self-end">
        Close
      </Button>
    </div>
  )
}
