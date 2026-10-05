// The landing media, imported through Vite ('?url'): every file gets a hashed
// /assets/ name (cached immutably) and nothing is inlined as a data: URI.
import tilemapJson from './media/tilemap.json'
import { checkTilemap, type Tilemap } from './tilemap.ts'

const urls = import.meta.glob<string>('./media/*.{mp4,avif,webp}', { query: '?url', import: 'default', eager: true })

export const TILEMAP: Tilemap = checkTilemap(tilemapJson)

/** URL of a file named in tilemap.json. */
export function mediaUrl(file: string): string {
  const url = urls[`./media/${file}`]
  if (!url) throw new Error(`landing media missing: ${file}`)
  return url
}

/** Longest wait for decode() once an image has loaded. Chrome does not settle
 * decode() while the tab is hidden; the texture upload decodes if needed. */
const DECODE_WAIT_MS = 1000

/** Loads an image for a texture. Rejects if the browser cannot load or decode
 * the format (e.g. AVIF on an old Safari). Waits briefly for an off-thread
 * decode so the first upload does not decode on the main thread. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const done = () => resolve(img)
      const timer = window.setTimeout(done, DECODE_WAIT_MS)
      img.decode().then(
        () => {
          window.clearTimeout(timer)
          done()
        },
        () => {
          window.clearTimeout(timer)
          done()
        },
      )
    }
    img.onerror = () => reject(new Error(`landing media failed to load: ${url}`))
    img.src = url
  })
}
