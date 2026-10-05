export type ShareData = { title: string; url: string }
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
}

/** Web Share API where the browser has it; otherwise (or if sharing is
 * refused) copy the link. A user closing the share sheet is not an error. */
export async function shareOrCopy(data: ShareData, nav: ShareNavigator = navigator): Promise<ShareResult> {
  if (typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
    try {
      await nav.share(data)
      return 'shared'
    } catch (err) {
      // DOMException is not an Error subclass everywhere, so check the name.
      if (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError') return 'cancelled'
      // NotAllowedError and friends: fall back to copying.
    }
  }
  try {
    if (!nav.clipboard) return 'failed'
    await nav.clipboard.writeText(data.url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Canonical link to an app page on this origin. */
export function pageUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}
