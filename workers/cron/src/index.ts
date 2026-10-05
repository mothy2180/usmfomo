// usmfomo-cron: hourly cleanup + keep-alive (wrangler.jsonc: "7 * * * *" UTC).
// Scheduled handler only: no fetch handler, no public URL.
import { type Env, runCron } from './cron.ts'

export default {
  async scheduled(_controller, env): Promise<void> {
    await runCron(env)
  },
} satisfies ExportedHandler<Env>
