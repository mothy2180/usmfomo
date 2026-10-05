// Poster file removal through the Storage API (SQL deletes on storage.objects
// are blocked on Supabase). The API takes at most 1000 names per call.
//
// Plain TypeScript with no runtime-specific imports: the owner CLI
// (scripts/account.ts, Node) uses removeInBatches too.
import { describeError } from './http.ts'

export const POSTERS_BUCKET = 'posters'
export const REMOVE_BATCH_SIZE = 1000

/** Removes one batch (≤ 1000 names) and returns how many objects were deleted. */
export type BatchRemover = (names: string[]) => Promise<number>

export type RemoveResult = { removed: number; failed: number }

/** De-duplicates, skips empty values, removes in batches; a failed batch is counted, not thrown. */
export async function removeInBatches(
  remove: BatchRemover,
  paths: ReadonlyArray<string | null | undefined>,
): Promise<RemoveResult> {
  const names = [...new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0))]
  let removed = 0
  let failed = 0
  for (let i = 0; i < names.length; i += REMOVE_BATCH_SIZE) {
    const batch = names.slice(i, i + REMOVE_BATCH_SIZE)
    try {
      removed += await remove(batch)
    } catch (err) {
      failed += batch.length
      console.error(JSON.stringify({ event: 'storage_remove_failed', files: batch.length, error: describeError(err) }))
    }
  }
  return { removed, failed }
}

/** The part of the supabase-js client that posterRemover uses. */
export type StorageRemoveClient = {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ data: unknown[] | null; error: unknown }>
    }
  }
}

/** Storage remove() of the posters bucket; resolves to the number of objects deleted. */
export function posterRemover(client: StorageRemoveClient): BatchRemover {
  return async (names) => {
    const { data, error } = await client.storage.from(POSTERS_BUCKET).remove(names)
    if (error) throw error
    return data?.length ?? 0
  }
}
