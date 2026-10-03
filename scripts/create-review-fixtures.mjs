import { mkdir, access, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'

// Always use a disposable repository-local profile, never the installed app's Library.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = join(repository, '.cache', 'next-level-review')
const library = join(profile, 'library')
const index = join(library, 'index.json')
let exists = false
try {
  await access(index)
  exists = true
} catch {}
if (exists) {
  console.log(`Review profile already exists; preserving it: ${profile}`)
  process.exit(0)
}
await mkdir(join(library, 'captures'), { recursive: true })
await mkdir(join(library, 'thumbnails'), { recursive: true })

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, payload) {
  const data = Buffer.concat([Buffer.from(type), payload])
  const header = Buffer.alloc(4),
    checksum = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  checksum.writeUInt32BE(crc32(data))
  return Buffer.concat([header, data, checksum])
}

function png(width, height, changed = false, seed = 0) {
  const pixels = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = y < 64 ? [32, 42, 62] : x < 144 ? [227, 232, 244] : [247, 249, 253]
      if (x >= 174 && x < Math.min(width - 24, 740) && y >= 96 && y < 148) color = [208, 218, 240]
      if (x >= 174 && x < 354 && y >= 192 && y < 260) color = [70, 101 + (seed % 60), 222]
      if (x >= 430 && x < 710 && y >= 192 && y < 260) color = [222, 229, 242]
      if (x >= 174 && x < Math.min(width - 24, 740) && y >= 324 && y % 56 < 28)
        color = [230, 235, 246]
      if (changed) {
        if (x >= 194 && x < 314 && y >= 202 && y < 240) color = [15, 167, 112]
        if (x >= 560 && x < 640 && y >= 354 && y < 414) color = [255, 92, 116]
        // A subtle eight-level change is invisible at tolerance 16 and visible at 0.
        if (x >= 50 && x < 80 && y >= 290 && y < 320) color = [219, 224, 236]
      }
      const offset = y * (width * 4 + 1) + 1 + x * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = 255
    }
  }
  const dimensions = Buffer.alloc(13)
  dimensions.writeUInt32BE(width, 0)
  dimensions.writeUInt32BE(height, 4)
  dimensions[8] = 8
  dimensions[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', dimensions),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const records = []
const now = Date.now()
async function add(title, width, height, changed, tags, seed = 0, age = records.length * 60_000) {
  const id = randomUUID()
  const filePath = join(library, 'captures', `${id}.png`)
  const thumbnail = join(library, 'thumbnails', `${id}.png`)
  const bytes = png(width, height, changed, seed)
  await writeFile(filePath, bytes)
  await writeFile(thumbnail, png(320, 200, changed, seed))
  records.push({
    id,
    title,
    createdAt: now - age,
    updatedAt: now - age,
    kind: 'image',
    width,
    height,
    filePath,
    thumbnail,
    tags,
    favorite: records.length < 5,
    byteSize: bytes.length,
    ocrVersion: 1,
    ocrText: title.includes('Draft') ? 'Invoice Marcus Bell draft' : 'Invoice Marcus Bell paid'
  })
}

await add('Compare 01 · Before', 800, 500, false, ['compare'], 0, 120000)
await add('Compare 02 · After', 800, 500, true, ['compare'], 0, 60000)
await add('Compare 03 · Identical to Before', 800, 500, false, ['compare'], 0, 30000)
await add('Compare 04 · Different dimensions', 1000, 650, true, ['compare'], 0, 20000)
await add('Compare 05 · Long page', 800, 5000, true, ['compare'], 0, 10000)
for (let number = 1; number <= 520; number++)
  await add(
    `Sample ${String(number).padStart(3, '0')}${number % 3 === 0 ? ' · Draft' : ''}`,
    320,
    200,
    false,
    ['large-library', number % 3 === 0 ? 'draft' : 'paid'],
    number,
    86400000 + number * 3600000
  )
await writeFile(index, JSON.stringify(records, null, 2), { flag: 'wx' })
console.log(`Created ${records.length} synthetic captures in ${profile}`)
console.log('The seeded search text tests Library search; use a real capture to test OCR.')
console.log(
  'Launch from the repository: CLIPTHAT_DEV_USER_DATA="$PWD/.cache/next-level-review" npm run dev'
)
