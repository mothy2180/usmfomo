// Test-only stand-in for publicDb (lib/db.ts), used through vi.mock. Every
// query-builder method (select, eq, order, range, limit, abortSignal,
// maybeSingle, ...) is recorded and returns the same builder; awaiting the
// builder resolves to whatever the handler returns for the finished call.

export type DbCall = {
  /** rpc('<fn>', args) */
  fn?: string
  args?: Record<string, unknown>
  /** from('<table>') */
  table?: string
  /** Builder methods in call order, e.g. [['eq', ['id', '…']], ['maybeSingle', []]]. */
  chain: Array<[method: string, args: unknown[]]>
}

export type DbResult = { data: unknown; error: unknown }
export type DbHandler = (call: DbCall) => DbResult | Promise<DbResult>

export function createFakeDb(handler: DbHandler) {
  const calls: DbCall[] = []
  const builder = (call: DbCall): unknown => {
    calls.push(call)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            const then: PromiseLike<DbResult>['then'] = (onFulfilled, onRejected) =>
              Promise.resolve()
                .then(() => handler(call))
                .then(onFulfilled, onRejected)
            return then
          }
          return (...args: unknown[]) => {
            call.chain.push([String(prop), args])
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const db = {
    rpc: (fn: string, args?: Record<string, unknown>) => builder({ fn, args, chain: [] }),
    from: (table: string) => builder({ table, chain: [] }),
  }
  return { db, calls }
}

/** The argument at `index` of the first builder method named `method`. */
export function callArg(call: DbCall, method: string, index = 0): unknown {
  return call.chain.find(([m]) => m === method)?.[1][index]
}

export const ok = (data: unknown): DbResult => ({ data, error: null })
export const fail = (message: string): DbResult => ({ data: null, error: { message, name: 'TypeError' } })
