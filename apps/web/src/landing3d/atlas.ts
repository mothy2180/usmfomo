// Which media the scene uses: the video atlas for this device class when the
// browser says it decodes smoothly (navigator.mediaCapabilities), otherwise
// the stills (frame 0 + posters) only.
import type { DeviceClass } from './layout.ts'
import type { Tilemap, VideoAtlas } from './tilemap.ts'

export type DecodeResult = { supported: boolean; smooth: boolean }

export type AtlasChoice = {
  /** Which clip atlas (video and its frame-0 still) the shards map into. */
  clips: DeviceClass
  /** Play the video; false = frame-0 still only. */
  video: boolean
  /** Which posters atlas. */
  stills: DeviceClass
}

/** The decodingInfo() question for one atlas (H.264 Main profile in MP4). */
export function decodingConfig(atlas: VideoAtlas, fps: number): MediaDecodingConfiguration {
  return {
    type: 'file',
    video: {
      contentType: `video/mp4; codecs="${atlas.codec}"`,
      width: atlas.width,
      height: atlas.height,
      bitrate: atlas.maxBitrate,
      framerate: fps,
    },
  }
}

const smooth = (r: DecodeResult | null | undefined): boolean => Boolean(r?.supported && r.smooth)

/**
 * Desktop: the 1920x960 atlas, else the 1152x576 one, else stills only.
 * Phones: the 1152x576 atlas or stills only.
 */
export function pickAtlas(cls: DeviceClass, results: Partial<Record<DeviceClass, DecodeResult | null>>): AtlasChoice {
  if (cls === 'desktop' && smooth(results.desktop)) return { clips: 'desktop', video: true, stills: cls }
  if (smooth(results.mobile)) return { clips: 'mobile', video: true, stills: cls }
  return { clips: cls, video: false, stills: cls }
}

type DecodingInfoLike = Pick<MediaCapabilities, 'decodingInfo'>

/** Asks only as much as needed, in order of preference. A missing API, an
 * error or a rejection all mean "stills only". */
export async function chooseAtlas(
  cls: DeviceClass,
  tilemap: Tilemap,
  mc: DecodingInfoLike | undefined = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined,
): Promise<AtlasChoice> {
  const order: DeviceClass[] = cls === 'desktop' ? ['desktop', 'mobile'] : ['mobile']
  const results: Partial<Record<DeviceClass, DecodeResult | null>> = {}
  for (const c of order) {
    let result: DecodeResult | null = null
    try {
      result = mc ? await mc.decodingInfo(decodingConfig(tilemap.video[c], tilemap.fps)) : null
    } catch {
      result = null
    }
    results[c] = result
    if (smooth(result)) break
  }
  return pickAtlas(cls, results)
}
