/**
 * Offline check for the screen-context extractors.
 *
 * OCRs a PNG with the same bundled Tesseract the app uses, then runs the real
 * extraction code over the result and prints what it found. Lets the table /
 * entity / redaction heuristics be iterated on in seconds instead of by launching
 * the whole app.
 *
 *   node scripts/extract-check.mjs <image.png> [--ocr-cache path.json]
 */
import { createWorker } from 'tesseract.js'
import { build } from 'esbuild'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const ocrAssets = join(root, 'src/renderer/public/ocr')

const imagePath = process.argv[2] ?? join(root, 'build/icon.png')
const cacheFlag = process.argv.indexOf('--ocr-cache')
const cachePath = cacheFlag !== -1 ? process.argv[cacheFlag + 1] : join(root, '.cache/ocr.json')

/* ---------- 1. OCR (cached, because it's the slow part) ---------- */

async function getOcr() {
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (cached.source === imagePath) {
      console.log(`· using cached OCR (${cached.result.words.length} words)`)
      return cached.result
    }
  }

  console.log('· running OCR…')
  const worker = await createWorker('eng', 1, {
    workerPath: join(root, 'node_modules/tesseract.js/src/worker-script/node/index.js'),
    corePath: join(root, 'node_modules/tesseract.js-core'),
    langPath: ocrAssets,
    gzip: true,
    logger: () => {}
  })
  const { data } = await worker.recognize(imagePath)
  await worker.terminate()

  const result = {
    text: data.text ?? '',
    words: (data.words ?? [])
      .filter((w) => w.text?.trim())
      .map((w) => ({
        text: w.text,
        confidence: w.confidence,
        bbox: {
          x: w.bbox.x0,
          y: w.bbox.y0,
          width: w.bbox.x1 - w.bbox.x0,
          height: w.bbox.y1 - w.bbox.y0
        }
      }))
  }

  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify({ source: imagePath, result }))
  console.log(`· OCR done (${result.words.length} words), cached`)
  return result
}

/* ---------- 2. bundle the real extractor ---------- */

async function loadExtract() {
  const out = join(root, '.cache/extract.mjs')
  mkdirSync(dirname(out), { recursive: true })
  await build({
    entryPoints: [join(root, 'src/renderer/shared/extract.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: out,
    logLevel: 'silent'
  })
  return import(pathToFileURL(out).href + `?t=${Date.now()}`)
}

/* ---------- 3. report ---------- */

const ocr = await getOcr()
const x = await loadExtract()

const rule = (label) => console.log(`\n\x1b[1m── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}\x1b[0m`)

rule('LINES')
const lines = x.toLines(ocr.words)
console.log(`${lines.length} lines`)
for (const line of lines.slice(0, 14)) {
  console.log(`  ${line.map((w) => w.text).join(' ')}`)
}

rule('TITLE')
console.log(' ', JSON.stringify(x.suggestTitle(ocr, 1600)))

rule('SENSITIVE')
for (const m of x.findSensitive(ocr)) {
  console.log(`  ${m.kind.padEnd(12)} ${JSON.stringify(m.text)}`)
}

rule('ENTITIES')
for (const e of x.extractEntities(ocr)) {
  console.log(`  ${e.kind.padEnd(8)} ${JSON.stringify(e.text)}`)
}

rule('TABLE')
const table = x.detectTable(ocr)
if (!table) {
  console.log('  none detected')
} else {
  console.log(`  ${table.rows.length} rows × ${table.columns} columns`)
  console.log(
    table.markdown
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')
  )
}
console.log()
