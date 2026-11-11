// Create / update / delete a post together with its poster and QR files, in the
// order that never leaves a row pointing at missing files:
//   upload new files -> write the row -> remove files no longer referenced.
// New files are removed again only when the database refused the row. When
// the answer was lost (offline, timeout) the row may have been written, so
// they stay; the daily orphan sweep (maint_orphans, unreferenced files over
// 24 h old) removes them if not, and anything a failed clean-up leaves behind.
import { newPosterPaths, newQrPath } from '@usmfomo/shared/images'
import { toInsertRow, type ValidPost } from './postForm.ts'
import type { PostInsertRow, PostPatch, PostRow } from './types.ts'

export type PosterFiles = {
  poster: Blob
  thumb: Blob
  ext: 'webp' | 'jpg'
  contentType: 'image/webp' | 'image/jpeg'
}

export type PosterChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; files: PosterFiles }

/** The registration QR image: one file, no thumbnail. */
export type QrFile = { blob: Blob; ext: 'webp' | 'jpg'; contentType: 'image/webp' | 'image/jpeg' }

export type QrChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; file: QrFile }

const KEEP_QR: QrChange = { kind: 'keep' }

/** The I/O submitPost needs (real implementation: ports.ts). Each throws on error. */
export type PostPorts = {
  upload: (path: string, file: Blob, contentType: string) => Promise<void>
  remove: (paths: string[]) => Promise<void>
  insert: (row: PostInsertRow) => Promise<{ id: string }>
  update: (id: string, patch: PostPatch) => Promise<void>
  delete: (id: string) => Promise<void>
  /** The org's own post this exact row would be (same poster file, or same
   * details when it has none), or null. */
  findOwn: (orgId: string, row: PostInsertRow) => Promise<{ id: string } | null>
}

type Paths = { poster: string; thumb: string }
type Uuid = () => string

const SQLSTATE = /^[0-9A-Z]{5}$/
const PGRST = /^PGRST\d+$/

/**
 * True only when the database certainly did not write: Postgres or PostgREST
 * answered with an error code (a request is one transaction, rolled back on
 * any error; NO_ROWS in ports.ts is 42501), or an HTTP 4xx. A lost answer
 * (code '', a TypeError, a timeout, a 5xx without a code) is not a refusal.
 */
export function isRefusal(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, status } = err as { code?: unknown; status?: unknown }
  if (typeof code === 'string' && (SQLSTATE.test(code) || PGRST.test(code))) return true
  return typeof status === 'number' && status >= 400 && status < 500
}

/** A create whose answer was lost (`cause`): `row`, as sent, may or may not
 * exist. The form keeps it, so Publish again looks for it before inserting. */
export class UnconfirmedCreate extends Error {
  readonly row: PostInsertRow

  constructor(row: PostInsertRow, cause: unknown) {
    super('Unconfirmed create', { cause })
    this.name = 'UnconfirmedCreate'
    this.row = row
  }
}

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

/** Uploads the QR image to a fresh random name in the org's folder. */
export async function uploadQr(ports: PostPorts, orgId: string, file: QrFile, uuid?: Uuid): Promise<string> {
  const path = newQrPath(orgId, file.ext, uuid)
  await ports.upload(path, file.blob, file.contentType)
  return path
}

/**
 * New post: upload (optional) -> insert. The files go again only if the
 * database refused the row. When its answer is lost this throws
 * UnconfirmedCreate; pass that row back as `unconfirmed` on the next attempt,
 * which then returns the post it wrote instead of posting twice.
 */
export async function createPost(
  ports: PostPorts,
  orgId: string,
  data: ValidPost,
  files: PosterFiles | null,
  opts: { uuid?: Uuid; unconfirmed?: PostInsertRow | null; qr?: QrFile | null } = {},
): Promise<string> {
  const { uuid, unconfirmed, qr = null } = opts
  if (unconfirmed) {
    let found: { id: string } | null
    try {
      found = await ports.findOwn(orgId, unconfirmed)
    } catch (err) {
      throw new UnconfirmedCreate(unconfirmed, err)
    }
    if (found) return found.id
    // Not written: its files are unreferenced and left for the orphan sweep.
  }
  const paths = files ? await uploadPoster(ports, orgId, files, uuid) : null
  let qrPath: string | null = null
  if (qr) {
    try {
      qrPath = await uploadQr(ports, orgId, qr, uuid)
    } catch (err) {
      if (paths) await bestEffortRemove(ports, [paths.poster, paths.thumb])
      throw err
    }
  }
  const row = toInsertRow(data, paths, qrPath)
  try {
    const { id } = await ports.insert(row)
    return id
  } catch (err) {
    if (!isRefusal(err)) throw new UnconfirmedCreate(row, err)
    await bestEffortRemove(ports, [paths?.poster ?? null, paths?.thumb ?? null, qrPath])
    throw err
  }
}

/**
 * Edit: upload a replacement (optional) -> update the row -> remove the old
 * files only after the update succeeded. "Remove poster" clears both paths in
 * the same update. Returns 'unchanged' (and writes nothing) when there is no
 * difference, because every UPDATE counts towards the daily edit limit. When
 * the answer is lost, neither the new nor the old files are removed (the row
 * may point at either); the orphan sweep takes whichever it doesn't.
 */
export async function updatePost(
  ports: PostPorts,
  post: Pick<PostRow, 'id' | 'org_id' | 'poster_path' | 'thumb_path'> & { qr_path?: string | null },
  patch: PostPatch,
  change: PosterChange,
  uuid?: Uuid,
  qr: QrChange = KEEP_QR,
): Promise<'saved' | 'unchanged'> {
  const full: PostPatch = { ...patch }
  const hadPoster = Boolean(post.poster_path || post.thumb_path)
  const hadQr = Boolean(post.qr_path)
  if (change.kind === 'remove' && hadPoster) {
    full.poster_path = null
    full.thumb_path = null
  }
  if (qr.kind === 'remove' && hadQr) full.qr_path = null
  if (Object.keys(full).length === 0 && change.kind !== 'replace' && qr.kind !== 'replace') return 'unchanged'

  let uploaded: Paths | null = null
  let uploadedQr: string | null = null
  if (change.kind === 'replace') {
    uploaded = await uploadPoster(ports, post.org_id, change.files, uuid)
    full.poster_path = uploaded.poster
    full.thumb_path = uploaded.thumb
  }
  if (qr.kind === 'replace') {
    try {
      uploadedQr = await uploadQr(ports, post.org_id, qr.file, uuid)
    } catch (err) {
      if (uploaded) await bestEffortRemove(ports, [uploaded.poster, uploaded.thumb])
      throw err
    }
    full.qr_path = uploadedQr
  }
  try {
    await ports.update(post.id, full)
  } catch (err) {
    if (isRefusal(err)) await bestEffortRemove(ports, [uploaded?.poster ?? null, uploaded?.thumb ?? null, uploadedQr])
    throw err
  }
  if (change.kind !== 'keep' && hadPoster) await bestEffortRemove(ports, [post.poster_path, post.thumb_path])
  if (qr.kind !== 'keep' && hadQr) await bestEffortRemove(ports, [post.qr_path ?? null])
  return 'saved'
}

/** Delete: remove the poster files first (they disappear at once), then the
 * row. A failed row delete can simply be retried; removing missing files is a
 * no-op. */
export async function deletePost(
  ports: PostPorts,
  post: Pick<PostRow, 'id' | 'poster_path' | 'thumb_path'> & { qr_path?: string | null },
): Promise<void> {
  const files = [post.poster_path, post.thumb_path, post.qr_path].filter((p): p is string => Boolean(p))
  if (files.length > 0) await ports.remove(files)
  await ports.delete(post.id)
}
