// MaintenancePort backed by the secret-key client: maint_* RPCs, the
// previous heartbeat (admin_status) and Storage remove(). maint_purge_expired
// and maint_orphans return one jsonb array each (0051), so PostgREST's
// max_rows (100) never cuts them.
import type { AdminClient } from '../_shared/client.ts'
import { rpc } from '../_shared/db.ts'
import { posterRemover, removeInBatches } from '../_shared/storage.ts'
import type { MaintenancePort, PurgedRow, Retention } from './run.ts'

type StatusRow = { last_maintenance_result?: { swept_at?: unknown } | null } | null

export function createMaintenancePort(client: AdminClient): MaintenancePort {
  const remove = posterRemover(client)
  return {
    async heartbeat(result) {
      await rpc<string>(client, 'maint_heartbeat', { p_result: result })
    },
    async purgeExpired(limit) {
      return (await rpc<PurgedRow[] | null>(client, 'maint_purge_expired', { p_limit: limit })) ?? []
    },
    async lastSweptAt() {
      // The heartbeat row is only readable through admin_status() (service-only).
      const status = await rpc<StatusRow>(client, 'admin_status')
      const value = status?.last_maintenance_result?.swept_at
      return typeof value === 'string' ? value : null
    },
    async orphans() {
      return (await rpc<string[] | null>(client, 'maint_orphans')) ?? []
    },
    retention: () => rpc<Retention>(client, 'maint_retention'),
    removeFiles: (paths) => removeInBatches(remove, paths),
  }
}
