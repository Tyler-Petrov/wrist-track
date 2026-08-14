// Draws the play mark used on every history row and writes it as a PNG into
// each target's asset directory. Kept as a script rather than a checked-in
// binary blob nobody can edit: the shape, size and colour are all here.
//
//   node tools/make-play-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = 26
const SUPERSAMPLE = 4
// COLORS.accent from page/home/theme.js — the same pink as the primary action.
const RGB = [0xe5, 0x7c, 0xd8]

/** Coverage of one pixel by the triangle, sampled on a finer grid. */
function coverage(px, py) {
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

const raw = []
for (let row = 0; row < SIZE; row += 1) {
  raw.push(0) // filter: none
  for (let column = 0; column < SIZE; column += 1) {
    const alpha = Math.round(coverage(column, row) * 255)
    raw.push(RGB[0], RGB[1], RGB[2], alpha)
  }
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.from(raw), { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

for (const target of ['assets/bip-max.w432-s']) {
  const path = `${target}/play.png`
  writeFileSync(path, png)
  console.log(`${path}  ${SIZE}x${SIZE}  ${png.length} bytes`)
}
