import { describe, expect, it, vi } from 'vitest'
import { shareOrCopy } from './share.ts'

const data = { title: 'Hack Night', url: 'https://usmfomo.pages.dev/e/x' }
const domError = (name: string) => new DOMException('nope', name)

describe('shareOrCopy', () => {
  it('uses the Web Share API when the browser has it', async () => {
    const share = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})
    expect(await shareOrCopy(data, { share, clipboard: { writeText } })).toBe('shared')
    expect(share).toHaveBeenCalledWith(data)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats closing the share sheet as cancelled, not an error', async () => {
    const writeText = vi.fn(async () => {})
    const share = vi.fn(async () => {
      throw domError('AbortError')
    })
    expect(await shareOrCopy(data, { share, clipboard: { writeText } })).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link when sharing is refused or unsupported', async () => {
    const writeText = vi.fn(async () => {})
    const refused = vi.fn(async () => {
      throw domError('NotAllowedError')
    })
    expect(await shareOrCopy(data, { share: refused, clipboard: { writeText } })).toBe('copied')
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe('copied')
    expect(await shareOrCopy(data, { share: vi.fn(), canShare: () => false, clipboard: { writeText } })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(data.url)
  })

  it('reports failure when neither works', async () => {
    const writeText = vi.fn(async () => {
      throw domError('NotAllowedError')
    })
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe('failed')
    expect(await shareOrCopy(data, {})).toBe('failed')
  })
})
