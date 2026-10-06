import { describe, expect, it } from 'vitest'
import type { ValidPost } from './postForm.ts'
import { createPost, deletePost, isRefusal, UnconfirmedCreate, updatePost, uploadPoster, type PostPorts, type PosterFiles } from './submitPost.ts'
import type { PostInsertRow } from './types.ts'

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

type Fail = Partial<Record<'upload-poster' | 'upload-thumb' | 'remove' | 'insert' | 'update' | 'delete' | 'findOwn', unknown>>

/** Fake I/O that records every call in order and fails where told to.
 * `found` is what findOwn answers. */
function fakePorts(fail: Fail = {}, found: { id: string } | null = null) {
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
    async findOwn(orgId, row) {
      log.push(`findOwn ${orgId} ${row.poster_path ?? row.title}`)
      if (fail.findOwn) throw fail.findOwn
      return found
    },
  }
  return { ports, log }
}

const NEW_POSTER = `${ORG}/${UUID}.webp`
const NEW_THUMB = `${ORG}/${UUID}-thumb.webp`
const OLD_POSTER = `${ORG}/44444444-4444-4444-8444-444444444444.jpg`
const OLD_THUMB = `${ORG}/44444444-4444-4444-8444-444444444444-thumb.jpg`
const quotaDaily = { code: 'P0001', message: 'quota_daily' }
/** What ports.ts throws when the response never came (postgrest-js: code ''). */
const lostAnswer = { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '', status: 0 }

describe('createPost', () => {
  it('inserts a post without a poster', async () => {
    const { ports, log } = fakePorts()
    await expect(createPost(ports, ORG, data, null, { uuid })).resolves.toBe(POST_ID)
    expect(log).toHaveLength(1)
    expect(log[0]).toContain('"poster_path":null')
    expect(log[0]).not.toContain('org_id')
  })

  it('uploads poster then thumbnail to fresh names, then inserts the row pointing at them', async () => {
    const { ports, log } = fakePorts()
    await createPost(ports, ORG, data, files, { uuid })
    expect(log[0]).toBe(`upload-poster ${NEW_POSTER} image/webp`)
    expect(log[1]).toBe(`upload-thumb ${NEW_THUMB} image/webp`)
    expect(log[2]).toContain(`"poster_path":"${NEW_POSTER}","thumb_path":"${NEW_THUMB}"`)
  })

  it('removes the uploaded files when the row is refused', async () => {
    const { ports, log } = fakePorts({ insert: quotaDaily })
    await expect(createPost(ports, ORG, data, files, { uuid })).rejects.toBe(quotaDaily)
    expect(log.at(-1)).toBe(`remove ${NEW_POSTER},${NEW_THUMB}`)
  })

  it('still reports the database error when that clean-up fails too', async () => {
    const { ports } = fakePorts({ insert: quotaDaily, remove: new TypeError('Failed to fetch') })
    await expect(createPost(ports, ORG, data, files, { uuid })).rejects.toBe(quotaDaily)
  })

  it('removes the files after an HTTP 4xx refusal that has no code (API gateway)', async () => {
    const tooLarge = { code: '', message: 'Payload too large', status: 413 }
    const { ports, log } = fakePorts({ insert: tooLarge })
    await expect(createPost(ports, ORG, data, files, { uuid })).rejects.toBe(tooLarge)
    expect(log.at(-1)).toBe(`remove ${NEW_POSTER},${NEW_THUMB}`)
  })

  it('keeps the files when the answer to the insert was lost: the row may point at them', async () => {
    for (const lost of [lostAnswer, new TypeError('Failed to fetch'), { code: '', message: 'Bad gateway', status: 502 }]) {
      const { ports, log } = fakePorts({ insert: lost })
      const err = await createPost(ports, ORG, data, files, { uuid }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnconfirmedCreate)
      expect((err as UnconfirmedCreate).cause).toBe(lost)
      // The exact row that was sent, for the retry to look for.
      expect((err as UnconfirmedCreate).row).toMatchObject({ title: 'Hack Night', poster_path: NEW_POSTER, thumb_path: NEW_THUMB })
      expect(log.some((l) => l.startsWith('remove'))).toBe(false)
    }
  })

  describe('a retry after a lost answer', () => {
    const sent: PostInsertRow = {
      title: 'Hack Night',
      venue: 'DK A',
      campus: 'main',
      description: null,
      link_url: null,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      poster_path: `${ORG}/55555555-5555-4555-8555-555555555555.webp`,
      thumb_path: `${ORG}/55555555-5555-4555-8555-555555555555-thumb.webp`,
    }

    it('returns the post that attempt wrote instead of posting twice', async () => {
      const { ports, log } = fakePorts({}, { id: POST_ID })
      await expect(createPost(ports, ORG, data, files, { uuid, unconfirmed: sent })).resolves.toBe(POST_ID)
      expect(log).toEqual([`findOwn ${ORG} ${sent.poster_path}`])
    })

    it('posts normally when that attempt wrote nothing (its files are left for the orphan sweep)', async () => {
      const { ports, log } = fakePorts({}, null)
      await expect(createPost(ports, ORG, data, files, { uuid, unconfirmed: sent })).resolves.toBe(POST_ID)
      expect(log[0]).toBe(`findOwn ${ORG} ${sent.poster_path}`)
      expect(log.slice(1, 3)).toEqual([`upload-poster ${NEW_POSTER} image/webp`, `upload-thumb ${NEW_THUMB} image/webp`])
      expect(log[3]).toContain(`"poster_path":"${NEW_POSTER}"`)
      expect(log.join('\n')).not.toContain(`remove ${sent.poster_path}`)
    })

    it('stays unconfirmed, writing nothing, while it still cannot look', async () => {
      const offline = new TypeError('Failed to fetch')
      const { ports, log } = fakePorts({ findOwn: offline })
      const err = await createPost(ports, ORG, data, files, { uuid, unconfirmed: sent }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnconfirmedCreate)
      expect((err as UnconfirmedCreate).row).toBe(sent)
      expect(log).toEqual([`findOwn ${ORG} ${sent.poster_path}`])
    })
  })
})

describe('isRefusal', () => {
  it('is true only when the database certainly wrote nothing', () => {
    // SQLSTATE (trigger, CHECK, RLS / NO_ROWS) and PostgREST codes: the request's transaction rolled back.
    expect(isRefusal(quotaDaily)).toBe(true)
    expect(isRefusal({ code: '23514', message: 'check' })).toBe(true)
    expect(isRefusal({ code: '42501', message: 'no rows matched' })).toBe(true)
    expect(isRefusal({ code: 'PGRST301', message: 'JWT expired' })).toBe(true)
    expect(isRefusal({ code: 'PGRST116', message: 'not one row' })).toBe(true)
    // An HTTP 4xx without a code (API gateway).
    expect(isRefusal({ code: '', message: 'Too many requests', status: 429 })).toBe(true)
    // Unknown outcome: no response, a timeout, a gateway 5xx, anything else.
    expect(isRefusal(lostAnswer)).toBe(false)
    expect(isRefusal(new TypeError('Failed to fetch'))).toBe(false)
    expect(isRefusal({ code: '', message: 'AbortError: timeout', status: 0 })).toBe(false)
    expect(isRefusal({ message: '<html>Bad gateway</html>', status: 502 })).toBe(false)
    expect(isRefusal({ code: 'abc', message: 'x' })).toBe(false)
    expect(isRefusal(null)).toBe(false)
    expect(isRefusal('quota_daily')).toBe(false)
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

  it('removes the new files when no row matched (NO_ROWS)', async () => {
    const noRows = { code: '42501', message: 'no rows matched' }
    const { ports, log } = fakePorts({ update: noRows })
    await expect(updatePost(ports, withPoster, {}, { kind: 'replace', files }, uuid)).rejects.toBe(noRows)
    expect(log.at(-1)).toBe(`remove ${NEW_POSTER},${NEW_THUMB}`)
  })

  it('keeps the new and the old files when the answer to the update was lost', async () => {
    const { ports, log } = fakePorts({ update: lostAnswer })
    await expect(updatePost(ports, withPoster, {}, { kind: 'replace', files }, uuid)).rejects.toBe(lostAnswer)
    expect(log.some((l) => l.startsWith('remove'))).toBe(false)
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
