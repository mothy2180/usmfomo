// Owner CLI: account management and break-glass from the owner's laptop
// (docs/api.md, "Owner CLI"). Run with `pnpm account <command> [args]`;
// `pnpm account --help` lists the commands.
//
// Node 26 runs this TypeScript directly (type stripping), so it uses no enums,
// namespaces or parameter properties. It talks to Auth Admin, PostgREST and
// Storage with plain fetch and the secret key in the apikey header only.
// Generated passwords go to stdout once and are never written to disk.
import { main } from './lib/cli.ts'

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  io: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
})
