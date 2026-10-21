// Draws the marks each row carries (play to start a job, stop to end the one
// running) and the app icon, and writes them as PNGs into each target's asset
// directory (the icon also to favicon.png at the root). Kept
// as a script rather than checked-in binary blobs nobody can edit: the shapes,
// sizes and colour are all here.
//
//   node tools/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = 26
const SUPERSAMPLE = 4
// From page/theme.js. Play sits on a tonal row, so it takes the accent
// pink; stop only ever sits on the accent-filled running row, so it takes the
// dark ink that reads against it.
const ACCENT = [0xe5, 0x7c, 0xd8]
const ON_ACCENT = [0x2c, 0x13, 0x38]

/** Coverage of one pixel by the play triangle, sampled on a finer grid. */
function playCoverage(px, py) {
  // A rounded-ish equilateral play mark inset from the edges.
  const left = SIZE * 0.24
  const right = SIZE * 0.8
  const top = SIZE * 0.16
  const bottom = SIZE * 0.84
  let hits = 0

  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const fx = px + (sx + 0.5) / SUPERSAMPLE
      const fy = py + (sy + 0.5) / SUPERSAMPLE
      if (fx < left || fx > right || fy < top || fy > bottom) continue
      // The triangle narrows linearly from the left edge to the right point.
      const progress = (fx - left) / (right - left)
      const halfHeight = ((bottom - top) / 2) * (1 - progress)
      const middle = (top + bottom) / 2
      if (Math.abs(fy - middle) <= halfHeight) hits += 1
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE)
}

/** The stop mark: a square with softened corners, optically matching play. */
function stopCoverage(px, py) {
  const inset = SIZE * 0.22
  const near = inset
  const far = SIZE - inset
  const radius = SIZE * 0.1
  let hits = 0

  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const fx = px + (sx + 0.5) / SUPERSAMPLE
      const fy = py + (sy + 0.5) / SUPERSAMPLE
      if (fx < near || fx > far || fy < near || fy > far) continue
      // Round the corners by measuring from the nearest corner centre.
      const dx = Math.max(near + radius - fx, fx - (far - radius), 0)
      const dy = Math.max(near + radius - fy, fy - (far - radius), 0)
      if (dx * dx + dy * dy <= radius * radius) hits += 1
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE)
}

const ICON_SIZE = 240

/** Distance from a point to the segment a-b, for drawing round-capped hands. */
function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/**
 * The app icon: a clock face in the accent pink with dark hands at ten past
 * twelve. Original artwork, so it can ship in a store listing.
 */
function iconPixel(px, py) {
  const centre = ICON_SIZE / 2
  const radius = ICON_SIZE * 0.47
  const hand = ICON_SIZE * 0.075
  const minute = [centre, centre - ICON_SIZE * 0.3]
  const angle = (60 * Math.PI) / 180 // two o'clock, from twelve
  const hour = [centre + Math.sin(angle) * ICON_SIZE * 0.2, centre - Math.cos(angle) * ICON_SIZE * 0.2]
  let disc = 0
  let ink = 0

  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const fx = px + (sx + 0.5) / SUPERSAMPLE
      const fy = py + (sy + 0.5) / SUPERSAMPLE
      if (Math.hypot(fx - centre, fy - centre) > radius) continue
      disc += 1
      const onHand =
        segmentDistance(fx, fy, centre, centre, minute[0], minute[1]) <= hand / 2 ||
        segmentDistance(fx, fy, centre, centre, hour[0], hour[1]) <= hand / 2
      if (onHand) ink += 1
    }
  }
  if (!disc) return [0, 0, 0, 0]
  const mix = ink / disc
  const rgb = ACCENT.map((value, index) => Math.round(value + (ON_ACCENT[index] - value) * mix))
  return [...rgb, Math.round((disc / (SUPERSAMPLE * SUPERSAMPLE)) * 255)]
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

let CRC_TABLE = null
function crc32(buffer) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ -1
}

function render(coverage, rgb) {
  return renderPixels(SIZE, (column, row) => [...rgb, Math.round(coverage(column, row) * 255)])
}

function renderPixels(size, pixel) {
  const raw = []
  for (let row = 0; row < size; row += 1) {
    raw.push(0) // filter: none
    for (let column = 0; column < size; column += 1) raw.push(...pixel(column, row))
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

for (const target of ['assets/bip-max.w432-s']) {
  for (const [name, coverage, rgb] of [
    ['play', playCoverage, ACCENT],
    ['stop', stopCoverage, ON_ACCENT]
  ]) {
    const path = `${target}/${name}.png`
    const png = render(coverage, rgb)
    writeFileSync(path, png)
    console.log(`${path}  ${SIZE}x${SIZE}  ${png.length} bytes`)
  }
}

const icon = renderPixels(ICON_SIZE, iconPixel)
for (const path of ['assets/bip-max.w432-s/icon.png', 'favicon.png']) {
  writeFileSync(path, icon)
  console.log(`${path}  ${ICON_SIZE}x${ICON_SIZE}  ${icon.length} bytes`)
}
