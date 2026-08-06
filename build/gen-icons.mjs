/**
 * Generates ClipThat's icon set with no image dependencies.
 * Run: node build/gen-icons.mjs
 *
 * Produces:
 *   build/icon.png            512x512 app icon (electron-builder derives .icns/.ico)
 *   build/trayTemplate.png    22x22 macOS template icon (black + alpha)
 *   build/trayTemplate@2x.png 44x44
 *   build/tray.png            32x32 colour tray icon for Windows/Linux
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/* ---------- minimal PNG encoder ---------- */

function crc32(buf) {
  let c
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba: Uint8ClampedArray of width*height*4 */
function encodePng(rgba, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- tiny software rasteriser ---------- */

function canvas(w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const i = (y * w + x) * 4
    const sa = a / 255
    const da = data[i + 3] / 255
    const oa = sa + da * (1 - sa)
    if (oa === 0) return
    data[i] = (r * sa + data[i] * da * (1 - sa)) / oa
    data[i + 1] = (g * sa + data[i + 1] * da * (1 - sa)) / oa
    data[i + 2] = (b * sa + data[i + 2] * da * (1 - sa)) / oa
    data[i + 3] = oa * 255
  }
  return { w, h, data, put }
}

/** Signed distance to a rounded rectangle; negative inside. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** Antialiased fill from a signed-distance function. */
function fillSdf(c, sdf, color, alpha = 255) {
  const [r, g, b] = color
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const d = sdf(x + 0.5, y + 0.5)
      const cov = Math.min(1, Math.max(0, 0.5 - d))
      if (cov > 0) c.put(x, y, r, g, b, alpha * cov)
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

/* ---------- the icon ---------- */

function appIcon(size) {
  const c = canvas(size, size)
  const s = size / 512
  const pad = 44 * s
  const radius = 112 * s

  // Body: diagonal indigo→violet gradient inside a squircle.
  const from = [79, 140, 255]
  const to = [167, 92, 255]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = sdRoundRect(x + 0.5, y + 0.5, size / 2, size / 2, size / 2 - pad, size / 2 - pad, radius)
      const cov = Math.min(1, Math.max(0, 0.5 - d))
      if (cov <= 0) continue
      const t = (x / size) * 0.55 + (y / size) * 0.45
      const [r, g, b] = mix(from, to, t)
      c.put(x, y, r, g, b, 255 * cov)
    }
  }

  // Selection brackets: four corner "L"s, the universal capture mark.
  const armLen = 108 * s
  const armThick = 26 * s
  const inset = 138 * s
  const white = [255, 255, 255]
  const corners = [
    [inset, inset, 1, 1],
    [size - inset, inset, -1, 1],
    [inset, size - inset, 1, -1],
    [size - inset, size - inset, -1, -1]
  ]
  for (const [ox, oy, sx, sy] of corners) {
    fillSdf(
      c,
      (x, y) => sdRoundRect(x, y, ox + (sx * armLen) / 2, oy, armLen / 2, armThick / 2, armThick / 2),
      white
    )
    fillSdf(
      c,
      (x, y) => sdRoundRect(x, y, ox, oy + (sy * armLen) / 2, armThick / 2, armLen / 2, armThick / 2),
      white
    )
  }

  // Centre dot — the "shutter".
  fillSdf(c, (x, y) => Math.hypot(x - size / 2, y - size / 2) - 40 * s, white, 245)

  return encodePng(c.data, size, size)
}

function trayIcon(size, template) {
  const c = canvas(size, size)
  const s = size / 22
  const color = template ? [0, 0, 0] : [235, 240, 250]
  const armLen = 7 * s
  const thick = 2 * s
  const inset = 4 * s
  const corners = [
    [inset, inset, 1, 1],
    [size - inset, inset, -1, 1],
    [inset, size - inset, 1, -1],
    [size - inset, size - inset, -1, -1]
  ]
  for (const [ox, oy, sx, sy] of corners) {
    fillSdf(c, (x, y) => sdRoundRect(x, y, ox + (sx * armLen) / 2, oy, armLen / 2, thick / 2, thick / 2), color)
    fillSdf(c, (x, y) => sdRoundRect(x, y, ox, oy + (sy * armLen) / 2, thick / 2, armLen / 2, thick / 2), color)
  }
  fillSdf(c, (x, y) => Math.hypot(x - size / 2, y - size / 2) - 2.6 * s, color)
  return encodePng(c.data, size, size)
}

mkdirSync(here, { recursive: true })
writeFileSync(join(here, 'icon.png'), appIcon(512))
writeFileSync(join(here, 'trayTemplate.png'), trayIcon(22, true))
writeFileSync(join(here, 'trayTemplate@2x.png'), trayIcon(44, true))
writeFileSync(join(here, 'tray.png'), trayIcon(32, false))
console.log('icons written to', here)
