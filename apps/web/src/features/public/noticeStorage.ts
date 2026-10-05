import { safeLocalStorage } from './storage.ts'

// A dismissed notice is remembered per id + updated_at: when the owner edits a
// notice it counts as new and shows again. Every access is wrapped in
// try/catch — blocked storage just means dismissals last for this visit only.

export const NOTICE_KEY_PREFIX = 'usmfomo.notice.dismissed:'

type NoticeVersion = { id: string; updated_at: string }

export function dismissKey(notice: NoticeVersion): string {
  return `${NOTICE_KEY_PREFIX}${notice.id}:${notice.updated_at}`
}

export function isDismissed(notice: NoticeVersion, storage: Storage | null = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(dismissKey(notice)) === '1'
  } catch {
    return false
  }
}

export function rememberDismissed(notice: NoticeVersion, storage: Storage | null = safeLocalStorage()): void {
  try {
    storage?.setItem(dismissKey(notice), '1')
  } catch {
    // ignore: quota or privacy settings
  }
}

/** Forget dismissals of notices that are no longer live (or were edited), so
 * the keys don't pile up. Only call with a successfully fetched, non-empty
 * list: an empty list may just mean public reads are switched off. */
export function pruneDismissed(live: readonly NoticeVersion[], storage: Storage | null = safeLocalStorage()): void {
  if (!storage || live.length === 0) return
  try {
    const keep = new Set(live.map(dismissKey))
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && key.startsWith(NOTICE_KEY_PREFIX) && !keep.has(key)) stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
  } catch {
    // ignore
  }
}
