import { describe, expect, it, vi } from 'vitest'
import { chooseAtlas, decodingConfig, pickAtlas, type DecodeResult } from './atlas.ts'
import { TILEMAP } from './media.ts'

const yes: DecodeResult = { supported: true, smooth: true }
const jerky: DecodeResult = { supported: true, smooth: false }
const no: DecodeResult = { supported: false, smooth: false }

/** A fake navigator.mediaCapabilities that answers per codec string. */
function capabilities(answers: Record<string, DecodeResult | Error>) {
  const decodingInfo = vi.fn(async (config: MediaDecodingConfiguration) => {
    const codec = /codecs="([^"]+)"/.exec(config.video?.contentType ?? '')?.[1] ?? ''
    const answer = answers[codec] ?? no
    if (answer instanceof Error) throw answer
    return { ...answer, powerEfficient: false } as MediaCapabilitiesDecodingInfo
  })
  return { decodingInfo }
}

describe('decodingConfig', () => {
  it('asks about H.264 Main profile at the atlas size, bitrate and frame rate', () => {
    expect(decodingConfig(TILEMAP.video.desktop, TILEMAP.fps)).toEqual({
      type: 'file',
      video: { contentType: 'video/mp4; codecs="avc1.4D4028"', width: 1920, height: 960, bitrate: 3_500_000, framerate: 24 },
    })
    expect(decodingConfig(TILEMAP.video.mobile, TILEMAP.fps)).toEqual({
      type: 'file',
      video: { contentType: 'video/mp4; codecs="avc1.4D401F"', width: 1152, height: 576, bitrate: 1_500_000, framerate: 24 },
    })
  })
})

describe('pickAtlas', () => {
  it('gives desktops the big atlas when it decodes smoothly', () => {
    expect(pickAtlas('desktop', { desktop: yes })).toEqual({ clips: 'desktop', video: true, stills: 'desktop' })
  })

  it('falls back to the small atlas, then to stills only', () => {
    expect(pickAtlas('desktop', { desktop: jerky, mobile: yes })).toEqual({ clips: 'mobile', video: true, stills: 'desktop' })
    expect(pickAtlas('desktop', { desktop: no, mobile: jerky })).toEqual({ clips: 'desktop', video: false, stills: 'desktop' })
    expect(pickAtlas('desktop', {})).toEqual({ clips: 'desktop', video: false, stills: 'desktop' })
  })

  it('gives phones the small atlas or stills only', () => {
    expect(pickAtlas('mobile', { mobile: yes })).toEqual({ clips: 'mobile', video: true, stills: 'mobile' })
    expect(pickAtlas('mobile', { mobile: jerky })).toEqual({ clips: 'mobile', video: false, stills: 'mobile' })
    expect(pickAtlas('mobile', { mobile: null })).toEqual({ clips: 'mobile', video: false, stills: 'mobile' })
  })
})

describe('chooseAtlas', () => {
  it('stops asking once an atlas is smooth', async () => {
    const mc = capabilities({ 'avc1.4D4028': yes })
    await expect(chooseAtlas('desktop', TILEMAP, mc)).resolves.toEqual({ clips: 'desktop', video: true, stills: 'desktop' })
    expect(mc.decodingInfo).toHaveBeenCalledOnce()
  })

  it('asks about the small atlas when the big one would stutter', async () => {
    const mc = capabilities({ 'avc1.4D4028': jerky, 'avc1.4D401F': yes })
    await expect(chooseAtlas('desktop', TILEMAP, mc)).resolves.toEqual({ clips: 'mobile', video: true, stills: 'desktop' })
    expect(mc.decodingInfo).toHaveBeenCalledTimes(2)
  })

  it('never asks a phone about the big atlas', async () => {
    const mc = capabilities({ 'avc1.4D4028': yes, 'avc1.4D401F': no })
    await expect(chooseAtlas('mobile', TILEMAP, mc)).resolves.toEqual({ clips: 'mobile', video: false, stills: 'mobile' })
    expect(mc.decodingInfo).toHaveBeenCalledOnce()
    expect(mc.decodingInfo.mock.calls[0]?.[0].video?.contentType).toContain('avc1.4D401F')
  })

  it('treats errors and a missing API as stills only', async () => {
    const mc = capabilities({ 'avc1.4D4028': new TypeError('bad config'), 'avc1.4D401F': new TypeError('bad config') })
    await expect(chooseAtlas('desktop', TILEMAP, mc)).resolves.toEqual({ clips: 'desktop', video: false, stills: 'desktop' })
    await expect(chooseAtlas('mobile', TILEMAP, undefined)).resolves.toEqual({ clips: 'mobile', video: false, stills: 'mobile' })
  })
})
