import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx'
import { useAnnounce } from '../../lib/announce.ts'
import { adminApi } from '../../lib/db.ts'
import { plural } from '../../lib/format.ts'
import { errorMessage } from '../../lib/messages.ts'
import { dropCachedPost, patchCachedPost, qk, setPostHidden, type ModPost } from '../../lib/queries.ts'

export type PostAction = 'hide' | 'unhide' | 'remove_image' | 'delete'

type Copy = { title: string; effect: ReactNode; confirmLabel: string; tone: 'danger' | 'primary' }

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
  const copy = copyFor(action, post)

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      switch (action) {
        case 'hide':
        case 'unhide': {
          const row = await setPostHidden(post.id, action === 'hide')
          patchCachedPost(queryClient, post.id, { hidden_at: row.hidden_at, updated_at: row.updated_at })
          return action === 'hide' ? `“${post.title}” hidden.` : `“${post.title}” is public again.`
        }
        case 'remove_image': {
          const files = await adminApi.removePostImage(post.id)
          patchCachedPost(queryClient, post.id, { poster_path: null, thumb_path: null })
          return files ? `Image removed (${plural(files, 'file')} deleted).` : 'Image removed.'
        }
        case 'delete': {
          const files = await adminApi.deletePost(post.id)
          dropCachedPost(queryClient, post.id)
          return files ? `Post deleted, with ${plural(files, 'poster file')}.` : 'Post deleted.'
        }
      }
    },
    onSuccess: (message) => {
      void queryClient.invalidateQueries({ queryKey: qk.status })
      onClose()
      announce(message)
    },
  })

  return (
    <ConfirmDialog
      open
      title={copy.title}
      confirmLabel={copy.confirmLabel}
      tone={copy.tone}
      busy={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      onConfirm={() => mutation.mutate()}
      onClose={onClose}
    >
      {copy.effect}
    </ConfirmDialog>
  )
}
