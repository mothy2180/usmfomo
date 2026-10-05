import { describe, expect, it } from 'vitest'
import { optionalImport, optionalImportPending } from './optionalImport.ts'

describe('optionalImport', () => {
  it('is pending only while the chunk loads, whether it loads or fails', async () => {
    expect(optionalImportPending()).toBe(false)
    let finish = (_v: string) => {}
    const ok = optionalImport(() => new Promise<string>((r) => (finish = r)))
    expect(optionalImportPending()).toBe(true)
    finish('module')
    await expect(ok).resolves.toBe('module')
    expect(optionalImportPending()).toBe(false)

    const failed = optionalImport(() => Promise.reject(new Error('chunk missing')))
    expect(optionalImportPending()).toBe(true)
    await expect(failed).rejects.toThrow('chunk missing')
    expect(optionalImportPending()).toBe(false)
  })
})
