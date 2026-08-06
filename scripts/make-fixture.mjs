/**
 * Regenerates an OCR fixture from a PNG. Fixtures are committed so the extraction
 * tests run in milliseconds and stay deterministic — they test our logic, not Tesseract.
 *
 *   node scripts/make-fixture.mjs tests/fixtures/invoices.png
 */
import { createWorker } from 'tesseract.js'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const image = process.argv[2]
if (!image) throw new Error('usage: make-fixture.mjs <image.png>')

const worker = await createWorker('eng', 1, {
  workerPath: join(root, 'node_modules/tesseract.js/src/worker-script/node/index.js'),
  corePath: join(root, 'node_modules/tesseract.js-core'),
  langPath: join(root, 'src/renderer/public/ocr'),
  gzip: true,
  logger: () => {}
})
const { data } = await worker.recognize(image)
await worker.terminate()

const result = {
  text: data.text ?? '',
  words: (data.words ?? [])
    .filter((w) => w.text?.trim())
    .map((w) => ({
      text: w.text,
      confidence: Math.round(w.confidence * 100) / 100,
      bbox: {
        x: w.bbox.x0,
        y: w.bbox.y0,
        width: w.bbox.x1 - w.bbox.x0,
        height: w.bbox.y1 - w.bbox.y0
      }
    }))
}

const out = image.replace(/\.png$/, '.json')
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(`${out}: ${result.words.length} words`)
