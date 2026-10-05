// Create / update / delete a post together with its poster files, in the
// order that never leaves a row pointing at missing files:
//   upload new files -> write the row -> remove files no longer referenced.
// Failures clean up after themselves; anything a failed clean-up leaves behind
// is removed by the daily orphan sweep (maint_orphans, files > 24 h old).
import { newPosterPaths } from '@usmfomo/shared/images'
import { toInsertRow, type ValidPost } from './postForm.ts'
import type { PostInsertRow, PostPatch, PostRow } from './types.ts'

export type PosterFiles = {
  poster: Blob
  thumb: Blob
  ext: 'webp' | 'jpg'
  contentType: 'image/webp' | 'image/jpeg'
}

export type PosterChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; files: PosterFiles }

/** The I/O submitPost needs (real implementation: ports.ts). Each throws on error. */
export type PostPorts = {
  upload: (path: string, file: Blob, contentType: string) => Promise<void>
  remove: (paths: string[]) => Promise<void>
  insert: (row: PostInsertRow) => Promise<{ id: string }>
  update: (id: string, patch: PostPatch) => Promise<void>
  delete: (id: string) => Promise<void>
}

type Paths = { poster: string; thumb: string }
type Uuid = () => string

async function bestEffortRemove(ports: PostPorts, paths: (string | null)[]): Promise<void> {
  const names = paths.filter((p): p is string => Boolean(p))
  if (names.length === 0) return
  try {
    await ports.remove(names)
  } catch {
    // Left for the orphan sweep: the row no longer references these files.
  }
}

/** Uploads poster + thumbnail to fresh random names in the org's folder. */
export async function uploadPoster(ports: PostPorts, orgId: string, files: PosterFiles, uuid?: Uuid): Promise<Paths> {
  const paths = newPosterPaths(orgId, files.ext, uuid)
  await ports.upload(paths.poster, files.poster, files.contentType)
  try {
    await ports.upload(paths.thumb, files.thumb, files.contentType)
  } catch (err) {
    await bestEffortRemove(ports, [paths.poster])
    throw err
  }
  return paths
}

/** New post: upload (optional) -> insert; the files go again if the insert fails. */
export async function createPost(
  ports: PostPorts,
  orgId: string,
  data: ValidPost,
  files: PosterFiles | null,
  uuid?: Uuid,
): Promise<string> {
  const paths = files ? await uploadPoster(ports, orgId, files, uuid) : null
  try {
    const { id } = await ports.insert(toInsertRow(data, paths))
    return id
  } catch (err) {
    if (paths) await bestEffortRemove(ports, [paths.poster, paths.thumb])
    throw err
  }
}

/**
 * Edit: upload a replacement (optional) -> update the row -> remove the old
 * files only after the update succeeded. "Remove poster" clears both paths in
 * the same update. Returns 'unchanged' (and writes nothing) when there is no
 * difference, because every UPDATE counts towards the daily edit limit.
 */
export async function updatePost(
  ports: PostPorts,
  post: Pick<PostRow, 'id' | 'org_id' | 'poster_path' | 'thumb_path'>,
  patch: PostPatch,
  change: PosterChange,
  uuid?: Uuid,
): Promise<'saved' | 'unchanged'> {
  const full: PostPatch = { ...patch }
  const hadPoster = Boolean(post.poster_path || post.thumb_path)
  if (change.kind === 'remove' && hadPoster) {
    full.poster_path = null
    full.thumb_path = null
  }
  if (Object.keys(full).length === 0 && change.kind !== 'replace') return 'unchanged'

  let uploaded: Paths | null = null
  if (change.kind === 'replace') {
    uploaded = await uploadPoster(ports, post.org_id, change.files, uuid)
    full.poster_path = uploaded.poster
    full.thumb_path = uploaded.thumb
  }
  try {
    await ports.update(post.id, full)
  } catch (err) {
    if (uploaded) await bestEffortRemove(ports, [uploaded.poster, uploaded.thumb])
    throw err
  }
  if (change.kind !== 'keep' && hadPoster) await bestEffortRemove(ports, [post.poster_path, post.thumb_path])
  return 'saved'
}

/** Delete: remove the poster files first (they disappear at once), then the
 * row. A failed row delete can simply be retried; removing missing files is a
 * no-op. */
export async function deletePost(ports: PostPorts, post: Pick<PostRow, 'id' | 'poster_path' | 'thumb_path'>): Promise<void> {
  const files = [post.poster_path, post.thumb_path].filter((p): p is string => Boolean(p))
  if (files.length > 0) await ports.remove(files)
  await ports.delete(post.id)
}
