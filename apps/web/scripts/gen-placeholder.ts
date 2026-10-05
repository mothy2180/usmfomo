// Generates public/landing/placeholder.svg: the static shattered-glass
// background (LCP image, and the no-WebGL / reduced-motion / lite fallback).
// Run: node apps/web/scripts/gen-placeholder.ts   (Node 26 strips TS types)
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { insetPolygon, makeShards, mulberry32 } from '../src/landing3d/shards.ts'

const W = 1600
const H = 900
const shards = makeShards({ width: W, height: H, count: 130, seed: 20261005 })
const rand = mulberry32(5)

// Deep blues/violets with a few gold "posters" — echoes the video tiles later.
const palette = [
  [222, 38, 16], [228, 32, 20], [250, 28, 18], [265, 26, 16],
  [205, 40, 18], [190, 35, 14], [44, 70, 30], [12, 55, 22],
]

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()
const path = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') + 'Z'

const cells: string[] = []
const cracks: string[] = []
for (const s of shards) {
  const [h, sat, l] = palette[Math.floor(rand() * palette.length)] as [number, number, number]
  const light = l + (1 - s.distance) * 6 + rand() * 6
  const inner = insetPolygon(s.polygon, s.centroid, 1.6)
  cells.push(`<path d="${path(inner)}" fill="hsl(${h} ${sat}% ${fmt(light)}%)"/>`)
  cracks.push(path(s.polygon))
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<radialGradient id="glow" cx="50%" cy="56%" r="60%"><stop offset="0" stop-color="#0b0d12" stop-opacity="0.15"/><stop offset="0.55" stop-color="#0b0d12" stop-opacity="0.55"/><stop offset="1" stop-color="#05070a" stop-opacity="0.85"/></radialGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#070910"/>
<g>${cells.join('')}</g>
<path d="${cracks.join('')}" fill="none" stroke="#dfe8ff" stroke-opacity="0.32" stroke-width="1.1" stroke-linejoin="round"/>
<rect width="${W}" height="${H}" fill="url(#sheen)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>
`

const out = resolve(import.meta.dirname, '../public/landing/placeholder.svg')
writeFileSync(out, svg)
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${shards.length} shards)`)
