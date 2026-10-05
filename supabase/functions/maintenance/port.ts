// MaintenancePort backed by the secret-key client: maint_* RPCs, the
// previous heartbeat (admin_status) and Storage remove().
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
    purgeExpired: (limit) => rpc<PurgedRow[]>(client, 'maint_purge_expired', { p_limit: limit }),
    async lastSweptAt() {
      // The heartbeat row is only readable through admin_status() (service-only).
      const status = await rpc<StatusRow>(client, 'admin_status')
      const value = status?.last_maintenance_result?.swept_at
      return typeof value === 'string' ? value : null
    },
    async orphans() {
      const rows = await rpc<{ name: string }[]>(client, 'maint_orphans')
      return rows.map((r) => r.name)
    },
    retention: () => rpc<Retention>(client, 'maint_retention'),
    removeFiles: (paths) => removeInBatches(remove, paths),
  }
}
