import { describe, expect, it } from 'vitest'
import type { ValidPost } from './postForm.ts'
import { createPost, deletePost, updatePost, uploadPoster, type PostPorts, type PosterFiles } from './submitPost.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const UUID = '33333333-3333-4333-8333-333333333333'
const POST_ID = '22222222-2222-4222-8222-222222222222'
const uuid = () => UUID

const data: ValidPost = {
  title: 'Hack Night',
  venue: 'DK A',
  campus: 'main',
  description: null,
  link_url: null,
  starts_at: '2026-10-11T12:00:00.000Z',
  ends_at: '2026-10-11T14:00:00.000Z',
}

const files: PosterFiles = {
  poster: new Blob(['p'], { type: 'image/webp' }),
  thumb: new Blob(['t'], { type: 'image/webp' }),
  ext: 'webp',
  contentType: 'image/webp',
}

type Fail = Partial<Record<'upload-poster' | 'upload-thumb' | 'remove' | 'insert' | 'update' | 'delete', unknown>>

/** Fake I/O that records every call in order and fails where told to. */
function fakePorts(fail: Fail = {}) {
  const log: string[] = []
  const ports: PostPorts = {
    async upload(path, _file, contentType) {
      const kind = path.endsWith(`-thumb.webp`) || path.endsWith('-thumb.jpg') ? 'upload-thumb' : 'upload-poster'
      log.push(`${kind} ${path} ${contentType}`)
      if (fail[kind]) throw fail[kind]
    },
    async remove(paths) {
      log.push(`remove ${paths.join(',')}`)
      if (fail.remove) throw fail.remove
    },
    async insert(insertRow) {
      log.push(`insert ${JSON.stringify(insertRow)}`)
      if (fail.insert) throw fail.insert
      return { id: POST_ID }
    },
    async update(id, patch) {
      log.push(`update ${id} ${JSON.stringify(patch)}`)
      if (fail.update) throw fail.update
    },
    async delete(id) {
      log.push(`delete ${id}`)
      if (fail.delete) throw fail.delete
    },
  }
  return { ports, log }
}

const NEW_POSTER = `${ORG}/${UUID}.webp`
const NEW_THUMB = `${ORG}/${UUID}-thumb.webp`
const OLD_POSTER = `${ORG}/44444444-4444-4444-8444-444444444444.jpg`
const OLD_THUMB = `${ORG}/44444444-4444-4444-8444-444444444444-thumb.jpg`
const quotaDaily = { code: 'P0001', message: 'quota_daily' }

describe('createPost', () => {
  it('inserts a post without a poster', async () => {
    const { ports, log } = fakePorts()
    await expect(createPost(ports, ORG, data, null, uuid)).resolves.toBe(POST_ID)
    expect(log).toHaveLength(1)
    expect(log[0]).toContain('"poster_path":null')
    expect(log[0]).not.toContain('org_id')
  })

  it('uploads poster then thumbnail to fresh names, then inserts the row pointing at them', async () => {
    const { ports, log } = fakePorts()
    await createPost(ports, ORG, data, files, uuid)
    expect(log[0]).toBe(`upload-poster ${NEW_POSTER} image/webp`)
    expect(log[1]).toBe(`upload-thumb ${NEW_THUMB} image/webp`)
    expect(log[2]).toContain(`"poster_path":"${NEW_POSTER}","thumb_path":"${NEW_THUMB}"`)
  })

  it('removes the uploaded files when the row is refused', async () => {
    const { ports, log } = fakePorts({ insert: quotaDaily })
    await expect(createPost(ports, ORG, data, files, uuid)).rejects.toBe(quotaDaily)
    expect(log.at(-1)).toBe(`remove ${NEW_POSTER},${NEW_THUMB}`)
  })

  it('still reports the database error when that clean-up fails too', async () => {
    const { ports } = fakePorts({ insert: quotaDaily, remove: new TypeError('Failed to fetch') })
    await expect(createPost(ports, ORG, data, files, uuid)).rejects.toBe(quotaDaily)
  })
})

describe('uploadPoster', () => {
  it('removes the poster again when the thumbnail upload fails', async () => {
    const refused = { name: 'StorageApiError', statusCode: '403' }
    const { ports, log } = fakePorts({ 'upload-thumb': refused })
    await expect(uploadPoster(ports, ORG, files, uuid)).rejects.toBe(refused)
    expect(log).toEqual([`upload-poster ${NEW_POSTER} image/webp`, `upload-thumb ${NEW_THUMB} image/webp`, `remove ${NEW_POSTER}`])
  })

  it('uses .jpg names for the JPEG fallback', async () => {
    const { ports, log } = fakePorts()
    const paths = await uploadPoster(ports, ORG, { ...files, ext: 'jpg', contentType: 'image/jpeg' }, uuid)
    expect(paths).toEqual({ poster: `${ORG}/${UUID}.jpg`, thumb: `${ORG}/${UUID}-thumb.jpg` })
    expect(log[0]).toBe(`upload-poster ${ORG}/${UUID}.jpg image/jpeg`)
  })
})

describe('updatePost', () => {
  const withPoster = { id: POST_ID, org_id: ORG, poster_path: OLD_POSTER, thumb_path: OLD_THUMB }
  const noPoster = { id: POST_ID, org_id: ORG, poster_path: null, thumb_path: null }

  it('writes nothing when nothing changed (every update counts towards the edit limit)', async () => {
    const { ports, log } = fakePorts()
    await expect(updatePost(ports, withPoster, {}, { kind: 'keep' }, uuid)).resolves.toBe('unchanged')
    await expect(updatePost(ports, noPoster, {}, { kind: 'remove' }, uuid)).resolves.toBe('unchanged')
    expect(log).toEqual([])
  })

  it('replaces a poster: upload new -> update row -> remove old files', async () => {
    const { ports, log } = fakePorts()
    await expect(updatePost(ports, withPoster, { title: 'New' }, { kind: 'replace', files }, uuid)).resolves.toBe('saved')
    expect(log).toEqual([
      `upload-poster ${NEW_POSTER} image/webp`,
      `upload-thumb ${NEW_THUMB} image/webp`,
      `update ${POST_ID} {"title":"New","poster_path":"${NEW_POSTER}","thumb_path":"${NEW_THUMB}"}`,
      `remove ${OLD_POSTER},${OLD_THUMB}`,
    ])
  })

  it('keeps the old files and removes the new ones when the update fails', async () => {
    const quotaEdits = { code: 'P0001', message: 'quota_edits' }
    const { ports, log } = fakePorts({ update: quotaEdits })
    await expect(updatePost(ports, withPoster, {}, { kind: 'replace', files }, uuid)).rejects.toBe(quotaEdits)
    expect(log.at(-1)).toBe(`remove ${NEW_POSTER},${NEW_THUMB}`)
    expect(log.join('\n')).not.toContain(OLD_POSTER)
  })

  it('"Remove poster" clears both paths in the row, then removes the files', async () => {
    const { ports, log } = fakePorts()
    await updatePost(ports, withPoster, {}, { kind: 'remove' }, uuid)
    expect(log).toEqual([`update ${POST_ID} {"poster_path":null,"thumb_path":null}`, `remove ${OLD_POSTER},${OLD_THUMB}`])
  })

  it('counts as saved when only the clean-up of old files fails (the orphan sweep gets them)', async () => {
    const { ports } = fakePorts({ remove: new TypeError('Failed to fetch') })
    await expect(updatePost(ports, withPoster, {}, { kind: 'remove' }, uuid)).resolves.toBe('saved')
  })

  it('adds a first poster to a post that had none', async () => {
    const { ports, log } = fakePorts()
    await updatePost(ports, noPoster, {}, { kind: 'replace', files }, uuid)
    expect(log).toHaveLength(3)
    expect(log[2]).toContain(`"poster_path":"${NEW_POSTER}"`)
  })
})

describe('deletePost', () => {
  it('removes the files first, then the row', async () => {
    const { ports, log } = fakePorts()
    await deletePost(ports, { id: POST_ID, poster_path: OLD_POSTER, thumb_path: OLD_THUMB })
    expect(log).toEqual([`remove ${OLD_POSTER},${OLD_THUMB}`, `delete ${POST_ID}`])
  })

  it('deletes a post without a poster directly', async () => {
    const { ports, log } = fakePorts()
    await deletePost(ports, { id: POST_ID, poster_path: null, thumb_path: null })
    expect(log).toEqual([`delete ${POST_ID}`])
  })

  it('keeps the row when the files could not be removed (try again)', async () => {
    const offline = new TypeError('Failed to fetch')
    const { ports, log } = fakePorts({ remove: offline })
    await expect(deletePost(ports, { id: POST_ID, poster_path: OLD_POSTER, thumb_path: OLD_THUMB })).rejects.toBe(offline)
    expect(log).not.toContain(`delete ${POST_ID}`)
  })
})
