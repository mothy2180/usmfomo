// Every zod import in the console goes through this module. zod 4 decides at
// schema *construction* time whether to compile parsers with `new Function`;
// the CSP has no 'unsafe-eval', so jitless must be set before any schema exists.
import { z } from 'zod'

z.config({ jitless: true })

export { z }
