// Generates public/landing/placeholder.svg (landscape, the desktop plan) and
// placeholder-portrait.svg (a phone's plan): frozen frames of the floating
// glass field, with the same field.ts maths and seed as the live scene, so the
// canvas fades in over the same glass. They are the LCP image, and the
// fallback for no WebGL2 / reduced motion / lite mode.
// Run: node apps/web/scripts/gen-placeholder.ts [outDir]   (Node 26 strips TS types)
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fogAmount, makeField, project, rotatedNormal, shardLook, worldPolygon, type FieldShard } from '../src/landing3d/field.ts'
import { planField, SHARD_SEED, type FieldPlan } from '../src/landing3d/layout.ts'
import { mulberry32 } from '../src/landing3d/random.ts'

// Poster-ish tones for the media facets until real media is on screen:
// deep blues and violets with a few warm accents (they read as content).
const palette = [
  ['#1d3b6e', '#2e5aa0'], ['#2a2357', '#4b3c8f'], ['#123d4a', '#1f6a7a'],
  ['#3d2347', '#6e3b7a'], ['#4a3412', '#9a6b1f'], ['#4a1d22', '#8f3440'],
]

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

type Frame = { file: string; width: number; height: number; plan: FieldPlan }

const FRAMES: Frame[] = [
  { file: 'placeholder.svg', width: 1600, height: 900, plan: planField(1920, 1080) },
  { file: 'placeholder-portrait.svg', width: 900, height: 1950, plan: planField(390, 844) },
]

function render({ width: W, height: H, plan }: Frame): { svg: string; drawn: number } {
  const aspect = W / H
  const field = makeField(plan, aspect, SHARD_SEED)
  const rand = mulberry32(17)
  const drawn: { depth: number; svg: string }[] = []
  const defs: string[] = []

  field.forEach((s: FieldShard, i: number) => {
    const screen = worldPolygon(s).map((p) => project(p, aspect))
    if (screen.some((p) => p === null)) return
    const xy = screen.map((p) => [((p![0] + 1) / 2) * W, ((1 - p![1]) / 2) * H] as const)
    // Entirely off the frame: nothing to draw.
    if (xy.every(([x]) => x < 0) || xy.every(([x]) => x > W) || xy.every(([, y]) => y < 0) || xy.every(([, y]) => y > H)) return
    const visibility = 1 - fogAmount(s.position[2])
    if (visibility < 0.04) return
    const look = shardLook(s.kind, rotatedNormal(s.quat), s.position[2])
    const d = 'M' + xy.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') + 'Z'
    const parts: string[] = []
    if (s.kind === 'media') {
      const [a, b] = palette[Math.floor(rand() * palette.length)]!
      defs.push(
        `<linearGradient id="m${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`,
      )
      parts.push(`<path d="${d}" fill="url(#m${i})" fill-opacity="${fmt(look.faceOpacity * visibility)}"/>`)
      if (look.glowOpacity > 0.03) parts.push(`<path d="${d}" fill="#e6eeff" fill-opacity="${fmt(look.glowOpacity * visibility)}"/>`)
      parts.push(`<path d="${d}" fill="none" stroke="#e6eeff" stroke-opacity="${fmt(look.edgeOpacity * visibility)}" stroke-width="1.2" stroke-linejoin="round"/>`)
    } else {
      parts.push(`<path d="${d}" fill="#b8cdf0" fill-opacity="${fmt(look.faceOpacity * visibility)}" stroke="#e6eeff" stroke-opacity="${fmt(look.edgeOpacity * visibility)}" stroke-width="1" stroke-linejoin="round"/>`)
    }
    drawn.push({ depth: -s.position[2], svg: parts.join('') })
  })

  // Far first, so near shards are painted on top.
  drawn.sort((a, b) => b.depth - a.depth)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<radialGradient id="bg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#0d1526"/><stop offset="1" stop-color="#05070b"/></radialGradient>
<radialGradient id="vignette" cx="50%" cy="52%" r="65%"><stop offset="0" stop-color="#05070b" stop-opacity="0.35"/><stop offset="0.6" stop-color="#05070b" stop-opacity="0"/><stop offset="1" stop-color="#05070b" stop-opacity="0.55"/></radialGradient>
${defs.join('\n')}
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${drawn.map((x) => x.svg).join('\n')}
<rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`
  return { svg, drawn: drawn.length }
}

const outDir = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../public/landing'))
for (const frame of FRAMES) {
  const { svg, drawn } = render(frame)
  const out = resolve(outDir, frame.file)
  writeFileSync(out, svg)
  console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${drawn} shards drawn)`)
}
