/** window.localStorage, or null where reading it throws (blocked site data,
 * some private modes) or there is no window (tests, prerender). */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readItem(key: string, storage: Storage | null = safeLocalStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeItem(key: string, value: string | null, storage: Storage | null = safeLocalStorage()): void {
  try {
    if (!storage) return
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, value)
  } catch {
    // Quota or privacy settings: the preference just isn't remembered.
  }
}
