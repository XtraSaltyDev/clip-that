import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { load } from './helpers.mjs'

const { imagePdfPageSize, imagePrintHtml, isPrintCancellation } = await load('src/shared/print.js')
const { IPC } = await load('src/shared/ipc.js')

test('print page contains only a fitted flattened capture and escaped title', () => {
  const html = imagePrintHtml('data:image/png;base64,AAAA', 'A <capture> & "notes"')
  assert.match(html, /<title>A &lt;capture&gt; &amp; &quot;notes&quot;<\/title>/)
  assert.match(html, /<body><img src="data:image\/png;base64,AAAA" alt=""><\/body>/)
  assert.match(html, /max-width: 100%/)
  assert.match(html, /max-height: 100%/)
  assert.match(html, /object-fit: contain/)
  assert.doesNotMatch(html, /<script/i)
})

test('print cancellation is distinct from printer failures', () => {
  assert.equal(isPrintCancellation('Print job canceled'), true)
  assert.equal(isPrintCancellation('Print job cancelled'), true)
  assert.equal(isPrintCancellation('Invalid printer settings'), false)
  assert.equal(isPrintCancellation('Print job failed'), false)
})

test('PDF page dimensions use inches and retain the capture aspect ratio', () => {
  assert.deepEqual(imagePdfPageSize(960, 1920), { width: 10, height: 20 })
  const landscape = imagePdfPageSize(430, 309)
  assert.ok(Math.abs(landscape.width * 72 - 322.5) < 0.001)
  assert.ok(Math.abs(landscape.height * 72 - 231.75) < 0.001)
  assert.ok(Math.abs(landscape.width / landscape.height - 430 / 309) < 1e-12)
})

test('PDF export rejects empty or non-finite image dimensions before printing', () => {
  for (const [width, height] of [
    [0, 1],
    [1, 0],
    [-1, 1],
    [NaN, 1],
    [1, Infinity]
  ]) {
    assert.throws(() => imagePdfPageSize(width, height), /no printable image dimensions/)
  }
})

test('editor-only print is wired through IPC, the Save menu, commands, and platform shortcut', async () => {
  assert.equal(IPC.printImage, 'export:print-image')
  const [handlers, preload, actions, app, commands, topBar] = await Promise.all(
    [
      'src/main/ipc/handlers.ts',
      'src/preload/index.ts',
      'src/renderer/editor/actions.ts',
      'src/renderer/editor/App.tsx',
      'src/renderer/editor/commands.ts',
      'src/renderer/editor/panels/TopBar.tsx'
    ].map((path) => readFile(path, 'utf8'))
  )
  assert.match(handlers, /secureHandle\(IPC\.printImage, \['editor'\]/)
  assert.match(preload, /print: \(dataUrl: string, name\?: string\)/)
  assert.match(actions, /api\.exports\.print\(png, doc\.title\)/)
  assert.match(app, /'mod\+p': \(\) => void actions\.print\(\)/)
  assert.match(commands, /id: 'export\.print'/)
  assert.match(commands, /shortcut: `\$\{mod\}P`/)
  assert.match(topBar, /> Print <span className="kbd">\{MOD_KEY\}P<\/span>/)
})
