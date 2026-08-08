/**
 * End-to-end self-test for the paths that cannot be unit-tested: screen recording
 * (getDisplayMedia → MediaRecorder → ffmpeg) and scrolling capture against a live,
 * genuinely scrolling window.
 *
 * Runs inside the real, packaged, permission-granted app:
 *
 *   CLIPTHAT_SELF_TEST=recording,scroll /Applications/ClipThat.app/Contents/MacOS/ClipThat
 *
 * Results go to the normal log file as [selftest] lines. Briefly shows windows and
 * records a few seconds of the primary display; all artifacts are deleted afterwards.
 */
import { BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { library } from '../store/library'
import { recording } from '../recording/session'
import { ffmpegPath } from '../recording/ffmpeg'
import {
  closeHudWindow,
  createEditorWindow,
  showHudWindow,
  getSingleton
} from '../windows/manager'
import { captureDisplay } from '../capture/backend'
import {
  cancelScrollCapture,
  startScrollCapture,
  finishScrollCapture,
  performCapture
} from '../capture/service'
import { app, clipboard, nativeImage } from 'electron'
import { join } from 'node:path'
import { settings } from '../store/settings'
import { createPin, pinCount, closeAllPins } from '../windows/pins'
import { quickWindow } from '../windows/quick'
import { openOverlay, closeOverlay, overlayVisible } from '../windows/overlay'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (line: string) => console.log(`[selftest] ${line}`)
const fail = (line: string) => console.error(`[selftest] FAIL: ${line}`)

async function until(
  what: string,
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  everyMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await wait(everyMs)
  }
  fail(`timed out after ${timeoutMs}ms waiting for: ${what}`)
  return false
}

/** Click the first button whose visible text matches. */
function clickButton(win: BrowserWindow, text: string): Promise<boolean> {
  return win.webContents.executeJavaScript(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)});
      if (b && !b.disabled) { b.click(); return true } return false })()`
  )
}

/** Probe a media file with the bundled ffmpeg; returns duration in seconds, or null. */
function probeDuration(file: string): Promise<number | null> {
  const bin = ffmpegPath()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(bin, ['-i', file], (_err, _stdout, stderr) => {
      // ffmpeg -i exits non-zero with no output file; the metadata is on stderr.
      const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(stderr))
      if (!m) return resolve(null)
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
    })
  })
}

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'build', 'clipthat-window-info')
    : join(app.getAppPath(), 'build', 'clipthat-window-info')
}

function moveCursor(x: number, y: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(helperPath(), ['--move-cursor', String(Math.round(x)), String(Math.round(y))], (error) =>
      error ? reject(error) : resolve()
    )
  })
}

function ffmpegBytes(args: string[]): Promise<Buffer> {
  const bin = ffmpegPath()
  if (!bin) return Promise.reject(new Error('ffmpeg is unavailable'))
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout as Buffer)
    )
  })
}

async function analyzeTemporalBands(file: string): Promise<{ ok: boolean; detail: string }> {
  const width = 64
  const height = 36
  const frameBytes = width * height * 3
  const bytes = await ffmpegBytes([
    '-v', 'error', '-i', file,
    '-vf', `fps=10,scale=${width}:${height}:flags=neighbor`,
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
  ])
  const frames = Math.floor(bytes.length / frameBytes)
  let compared = 0
  let mismatches = 0
  const bandScore = (offset: number, fromY: number, toY: number): number => {
    let score = 0
    let pixels = 0
    for (let y = fromY; y < toY; y += 1) {
      for (let x = 4; x < width - 4; x += 1) {
        const index = offset + (y * width + x) * 3
        score += bytes[index] - bytes[index + 2]
        pixels += 1
      }
    }
    return score / pixels
  }
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * frameBytes
    const center = bandScore(offset, 15, 21)
    const bottom = bandScore(offset, 31, 35)
    // Ignore the few blended frames at each red/blue source transition.
    if (Math.abs(center) < 45 || Math.abs(bottom) < 45) continue
    compared += 1
    if (Math.sign(center) !== Math.sign(bottom)) mismatches += 1
  }
  return {
    ok: frames >= 80 && compared >= 40 && mismatches === 0,
    detail: `${frames} decoded frames, ${compared} strong comparisons, ${mismatches} bottom-band mismatches`
  }
}

const RECORDING_SENTINEL = `<!doctype html><meta charset="utf-8"><title>ClipThat Recording Sentinel</title>
<style>
  html,body { width:100%; height:100%; margin:0; overflow:hidden; }
  body { background:#f01818; color:#fff; font:700 44px ui-monospace,monospace; }
  body.blue { background:#1828f0; }
  main { position:absolute; inset:0; display:grid; place-items:center; }
  footer { position:absolute; left:0; right:0; bottom:0; height:15%; border-top:12px solid #fff; display:grid; place-items:center; }
</style><main>AUTO-ZOOM PIXEL SENTINEL</main><footer>BOTTOM BAND</footer>
<script>setInterval(() => document.body.classList.toggle('blue'), 500)</script>`

async function createRecordingSentinel(): Promise<BrowserWindow> {
  const display = screen.getPrimaryDisplay()
  const win = createEditorWindow()
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(RECORDING_SENTINEL)}`)
  win.setTitle('ClipThat Recording Sentinel')
  win.setBounds({
    x: display.workArea.x + 24,
    y: display.workArea.y + 24,
    width: Math.max(900, display.workArea.width - 48),
    height: Math.max(650, display.workArea.height - 48)
  })
  win.show()
  return win
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

async function testRecording(
  format: 'MP4' | 'GIF',
  variant: { autoZoom?: boolean; sentinel?: BrowserWindow } = {}
): Promise<boolean> {
  const label = variant.autoZoom ? `${format}+zoom` : format
  log(`recording/${label}: starting`)
  const before = library.list({ kind: 'video', limit: 1000 }).map((i) => i.id)

  const hud = showHudWindow()
  await new Promise<void>((r) =>
    hud.webContents.isLoading()
      ? hud.webContents.once('did-finish-load', () => r())
      : r()
  )
  await wait(1800) // sources + settings fetch

  // Countdown to zero so the test doesn't sit through it. The setup screen has exactly
  // one range input (Countdown) while mic/webcam are off.
  await hud.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[type="range"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '0')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await wait(200)

  if (variant.sentinel) {
    if (!(await clickButton(hud, 'Window'))) {
      fail(`recording/${label}: Window target button not found`)
      return false
    }
    await wait(300)
    const selected = await hud.webContents.executeJavaScript(`(() => {
      const select = [...document.querySelectorAll('select')].find((element) =>
        [...element.options].some((option) => option.textContent.includes('Recording Sentinel'))
      )
      const option = select && [...select.options].find((item) =>
        item.textContent.includes('Recording Sentinel')
      )
      if (!select || !option) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(select, option.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    if (!selected) {
      fail(`recording/${label}: sentinel window was not offered as a recording source`)
      return false
    }
    await wait(300)
  }

  if (variant.autoZoom) {
    const toggled = await hud.webContents.executeJavaScript(`(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Auto-zoom'))
      const input = label && label.querySelector('input[type="checkbox"]')
      if (!input) return false
      if (!input.checked) input.click()
      return true
    })()`)
    if (!toggled) {
      fail(`recording/${label}: Auto-zoom toggle not found`)
      return false
    }
    await wait(300)
  }

  if (!(await clickButton(hud, 'Start recording'))) {
    fail(`recording/${label}: Start button missing or disabled`)
    return false
  }

  if (!(await until('recorder to reach recording state', () => recording.status().state === 'recording', 25000))) {
    const w = getSingleton('hud')
    const dom = w
      ? await w.webContents
          .executeJavaScript(`document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400)`)
          .catch(() => '(no dom)')
      : '(hud gone)'
    fail(`recording/${label}: main state=${recording.status().state}; hud shows: ${dom}`)
    return false
  }
  const captureMs = variant.sentinel ? 16_000 : 4_000
  log(`recording/${label}: capturing ${captureMs / 1000}s`)
  if (variant.sentinel) {
    const bounds = variant.sentinel.getContentBounds()
    const points = [
      [0.5, 0.5], [0.1, 0.88], [0.9, 0.88], [0.12, 0.12], [0.88, 0.12], [0.5, 0.92]
    ]
    const started = Date.now()
    let index = 0
    while (Date.now() - started < captureMs) {
      const [x, y] = points[index % points.length]
      await moveCursor(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
      index += 1
      await wait(1800)
    }
  } else {
    await wait(captureMs)
  }

  // Stop through the same path the global hotkey uses.
  recording.markStopping()
  getSingleton('hud')?.webContents.send('record:hud-command', { command: 'stop' })

  const hudNow = () => getSingleton('hud')
  if (
    !(await until(
      'review screen',
      async () => {
        const w = hudNow()
        if (!w) return false
        return w.webContents.executeJavaScript(
          `[...document.querySelectorAll('button')].some(b => b.textContent.trim().startsWith('Save '))`
        )
      },
      20000
    ))
  ) {
    return false
  }

  let rawEvidence: string | null = null
  if (variant.sentinel && recording.rawFile()) {
    rawEvidence = join(app.getPath('userData'), 'logs', 'selftest-autozoom-raw.webm')
    await fs.copyFile(recording.rawFile()!, rawEvidence)
  }

  if (format === 'GIF') {
    const w = hudNow()
    if (!w || !(await clickButton(w, 'GIF'))) {
      fail('recording/GIF: format toggle not found')
      return false
    }
    await wait(200)
  }

  const w = hudNow()
  if (!w || !(await clickButton(w, `Save ${format}`))) {
    fail(`recording/${label}: Save button not found`)
    return false
  }

  if (
    !(await until(
      'encoded file in the library',
      () => library.list({ kind: 'video', limit: 1000 }).some((i) => !before.includes(i.id)),
      90000,
      1000
    ))
  ) {
    return false
  }

  const item = library.list({ kind: 'video', limit: 1000 }).find((i) => !before.includes(i.id))!
  const stat = await fs.stat(item.filePath).catch(() => null)
  const duration = await probeDuration(item.filePath)

  log(
    `recording/${label}: ${item.filePath.split('/').pop()} — ` +
      `${stat ? Math.round(stat.size / 1024) : 0} KB, ` +
      `${item.width}x${item.height}, duration=${duration?.toFixed(2) ?? '?'}s, ` +
      `poster=${item.thumbnail ? 'yes' : 'NO'}`
  )

  let ok = true
  if (!stat || stat.size < 20_000) {
    fail(`recording/${label}: file is implausibly small (${stat?.size ?? 0} bytes)`)
    ok = false
  }
  if (duration === null || duration < 2) {
    fail(`recording/${label}: duration ${duration ?? 'unreadable'} — expected ≥ 2s`)
    ok = false
  }

  if (variant.sentinel && rawEvidence) {
    try {
      const [rawPixels, deliveryPixels] = await Promise.all([
        analyzeTemporalBands(rawEvidence),
        analyzeTemporalBands(item.filePath)
      ])
      log(`recording/${label}: raw pixels — ${rawPixels.detail}`)
      log(`recording/${label}: MP4 pixels — ${deliveryPixels.detail}`)
      if (!rawPixels.ok || !deliveryPixels.ok) {
        fail(`recording/${label}: temporal bottom-band validation failed; evidence retained`)
        log(`recording/${label}: raw evidence → ${rawEvidence}`)
        log(`recording/${label}: delivery evidence → ${item.filePath}`)
        ok = false
      }
    } catch (error) {
      fail(`recording/${label}: pixel analysis failed — ${(error as Error).message}`)
      ok = false
    }
  }

  if (ok) {
    await library.remove([item.id])
    if (rawEvidence) await fs.rm(rawEvidence, { force: true })
    log(`recording/${label}: PASS (artifacts deleted)`)
  }
  return ok
}

async function testAutoZoomPixels(): Promise<boolean> {
  const originalCursor = screen.getCursorScreenPoint()
  const sentinel = await createRecordingSentinel()
  try {
    return await testRecording('MP4', { autoZoom: true, sentinel })
  } finally {
    await moveCursor(originalCursor.x, originalCursor.y).catch(() => {})
    if (!sentinel.isDestroyed()) sentinel.destroy()
  }
}

/* ------------------------------------------------------------------ *
 * Scrolling capture
 * ------------------------------------------------------------------ */

const SCROLL_PAGE = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; font: 700 28px ui-monospace, monospace; }
  .row { height: 60px; display: flex; align-items: center; padding-left: 24px; color: #fff; }
</style><body>
${Array.from({ length: 60 })
  .map(
    (_, i) =>
      `<div class="row" style="background:hsl(${(i * 47) % 360} 65% 42%)">ROW ${String(i).padStart(3, '0')} — clipthat scroll self test</div>`
  )
  .join('')}
</body>`

async function testScroll(): Promise<boolean> {
  log('scroll: starting')

  const display = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: display.workArea.x + 40,
    y: display.workArea.y + 40,
    width: 640,
    height: 480,
    alwaysOnTop: true,
    title: 'ClipThat scroll self-test',
    webPreferences: { sandbox: true }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SCROLL_PAGE)}`)
  win.setAlwaysOnTop(true, 'screen-saver')
  await wait(800)

  try {
    const content = win.getContentBounds()
    const rect = {
      x: (content.x - display.bounds.x) * display.scaleFactor,
      y: (content.y - display.bounds.y) * display.scaleFactor,
      width: content.width * display.scaleFactor,
      height: content.height * display.scaleFactor
    }

    startScrollCapture(String(display.id), rect, content)
    void recording.prewarmDisplaySources()
    const hud = showHudWindow('scroll')
    await new Promise<void>((resolve) =>
      hud.webContents.isLoading() ? hud.webContents.once('did-finish-load', () => resolve()) : resolve()
    )

    const { scrollFrameCount } = await import('../capture/service')
    if (!(await until('first scroll frame', () => scrollFrameCount() >= 1, 40000))) {
      return false
    }

    // Six deliberate steps. Wait for the stream to observe each state; this tests the
    // production hand-off instead of assuming a particular compositor frame rate.
    for (let step = 1; step <= 6; step++) {
      const before = scrollFrameCount()
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${step * 200})`)
      if (!(await until(`scroll frame ${step + 1}`, () => scrollFrameCount() > before, 15000, 100))) {
        return false
      }
    }

    const frames = scrollFrameCount()
    log(`scroll: ${frames} frames collected before stitch`)
    if (frames < 4) fail(`scroll: cadence too low — ${frames} frames for 6 scroll steps`)
    const result = await finishScrollCapture()
    closeHudWindow()
    if (!result) {
      fail('scroll: stitch returned nothing')
      return false
    }

    const frameH = rect.height
    const ratio = result.height / frameH
    log(
      `scroll: stitched ${result.width}x${result.height} from viewport ${Math.round(rect.width)}x${Math.round(frameH)} ` +
      `(${ratio.toFixed(2)}x taller)`
    )

    // 6 steps × 200 DIP ≈ 1200 DIP of new content ≈ 2.5 viewports on top of the first.
    if (ratio < 1.5) {
      fail(`scroll: expected the stitch to be ≥1.5x the viewport, got ${ratio.toFixed(2)}x`)
      return false
    }
    const img = nativeImage.createFromDataURL(result.dataUrl)
    if (img.isEmpty()) {
      fail('scroll: stitched image does not decode')
      return false
    }
    log('scroll: PASS')
    return true
  } finally {
    cancelScrollCapture()
    closeHudWindow()
    if (!win.isDestroyed()) win.destroy()
  }
}

/* ------------------------------------------------------------------ *
 * Quick access, pins, pipelines, latency
 * ------------------------------------------------------------------ */

async function snapWindow(win: Electron.BrowserWindow | null, name: string): Promise<void> {
  if (!win || win.isDestroyed()) return
  try {
    const png = await win.webContents.capturePage()
    const file = join(app.getPath('userData'), 'logs', `selftest-${name}.png`)
    await fs.writeFile(file, png.toPNG())
    log(`${name}: screenshot → ${file}`)
  } catch {
    /* screenshots are evidence, not assertions */
  }
}

async function testQuickAccess(): Promise<boolean> {
  log('quick: starting')
  const prevAfter = settings.get().afterCapture
  settings.set({ afterCapture: 'quickAccess' })
  const before = library.list({ kind: 'image', limit: 2000 }).map((i) => i.id)
  clipboard.clear()

  try {
    const result = await performCapture({ mode: 'display' })
    if (!result) {
      fail('quick: display capture returned nothing')
      return false
    }
    if (!(await until('quick access card', () => quickWindow() !== null, 8000))) return false
    const card = quickWindow()!
    await wait(900)
    await snapWindow(card, 'quick-card')

    // The capture must already be safe in the library before any card action.
    const added = library.list({ kind: 'image', limit: 2000 }).filter((i) => !before.includes(i.id))
    if (added.length !== 1) {
      fail(`quick: expected 1 library item, found ${added.length}`)
      return false
    }

    if (!(await clickButton(card, 'Copy'))) {
      fail('quick: Copy button not found')
      return false
    }
    if (!(await until('clipboard image', () => !clipboard.readImage().isEmpty(), 5000))) return false

    // Copy confirms briefly and then dismisses itself.
    if (!(await until('card to self-dismiss', () => quickWindow() === null, 5000))) return false

    await library.remove(added.map((i) => i.id))
    log('quick: PASS (copy verified, card dismissed, artifact deleted)')
    return true
  } finally {
    settings.set({ afterCapture: prevAfter })
  }
}

async function testPin(): Promise<boolean> {
  log('pin: starting')
  // A recognisable 320x200 test card.
  const canvasPng = nativeImage.createFromDataURL(makeTestImage(320, 200))
  const win = createPin(canvasPng.toDataURL())
  if (!win) {
    fail('pin: window did not open')
    return false
  }
  await wait(900)
  const [w, h] = win.getSize()
  const aspectOk = Math.abs(w / h - 320 / 200) < 0.05
  await snapWindow(win, 'pin')
  const count = pinCount()
  closeAllPins()

  if (!aspectOk) {
    fail(`pin: aspect drifted — ${w}x${h} for a 320x200 image`)
    return false
  }
  if (count !== 1) {
    fail(`pin: expected 1 pin, found ${count}`)
    return false
  }
  log('pin: PASS')
  return true
}

async function testPipeline(): Promise<boolean> {
  log('pipeline: starting')
  const prev = settings.get()
  const marker = join(app.getPath('userData'), 'logs', 'pipeline-marker.txt')
  await fs.rm(marker, { force: true }).catch(() => {})
  const before = library.list({ kind: 'image', limit: 2000 }).map((i) => i.id)
  clipboard.clear()

  settings.set({
    afterCapture: 'pipeline',
    pipeline: { copy: true, save: true, pin: true, edit: false, command: `test -f {file} && date > ${JSON.stringify(marker)}` }
  })

  try {
    const result = await performCapture({ mode: 'display' })
    if (!result) {
      fail('pipeline: capture returned nothing')
      return false
    }

    let ok = true
    if (!(await until('pipeline marker file', () => fs.stat(marker).then(() => true).catch(() => false), 15000))) ok = false
    if (clipboard.readImage().isEmpty()) {
      fail('pipeline: clipboard is empty after copy step')
      ok = false
    }
    if (pinCount() !== 1) {
      fail(`pipeline: expected 1 pin, found ${pinCount()}`)
      ok = false
    }

    const added = library.list({ kind: 'image', limit: 2000 }).filter((i) => !before.includes(i.id))
    closeAllPins()
    await library.remove(added.map((i) => i.id))
    await fs.rm(marker, { force: true }).catch(() => {})

    if (ok) log('pipeline: PASS (save + copy + pin + command all ran)')
    return ok
  } finally {
    settings.set({ afterCapture: prev.afterCapture, pipeline: prev.pipeline })
  }
}

async function testLatency(): Promise<boolean> {
  log('latency: starting')
  const runs: number[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    const selection = openOverlay('region')
    // macOS's reliable full-resolution CLI path varies from roughly 1–10 seconds under
    // load. Keep the harness alive long enough to measure it, then apply the budget below.
    const shown = await until('overlay visible', () => overlayVisible(), 20000, 25)
    const elapsed = Date.now() - t0
    closeOverlay(null)
    await selection
    if (!shown) return false
    runs.push(elapsed)
    // Back-to-back requests are not representative and can keep ScreenCaptureKit from
    // settling, especially with two physical displays.
    await wait(1200)
  }
  const best = Math.min(...runs)
  log(`latency: hotkey→crosshair ${runs.join('ms, ')}ms (best ${best}ms)`)
  // Budget reflects what the OS capture service costs for full-resolution shots of
  // every attached display; the app's own share (pool show) is ~10ms. Regressions in
  // *our* code — a re-added overlapping request, a lost window pool — blow past this.
  const budget = 6000 + 2500 * Math.max(0, screen.getAllDisplays().length - 1)
  if (best > budget) {
    fail(`latency: best run ${best}ms exceeds the ${budget}ms budget`)
    return false
  }
  log('latency: PASS')
  return true
}

async function testWindowPicker(): Promise<boolean> {
  log('window: starting')
  const target = new BrowserWindow({
    width: 520,
    height: 320,
    title: 'Window source self-test',
    webPreferences: { sandbox: true }
  })
  await target.loadURL('data:text/html,<title>Window source self-test</title><body>capture target</body>')
  target.show()
  await wait(500)

  try {
    const selection = openOverlay('window')
    if (!(await until('window picker visible', () => overlayVisible(), 8000, 25))) {
      closeOverlay(null)
      await selection
      return false
    }

    const visible = BrowserWindow.getAllWindows().filter(
      (win) =>
        !win.isDestroyed() && win.isVisible() && win.webContents.getURL().includes('/overlay.html')
    )
    if (visible.length !== 1) {
      fail(`window: expected one visible picker, found ${visible.length}`)
      closeOverlay(null)
      await selection
      return false
    }

    const picker = visible[0]
    const rendered = await until(
      'window picker renderer',
      () => picker.webContents.executeJavaScript("Boolean(document.querySelector('.ov-picker'))"),
      5000,
      100
    )
    const listReady =
      rendered &&
      (await until(
        'window source card',
        () => picker.webContents.executeJavaScript("document.querySelectorAll('.ov-card').length > 0"),
        10000,
        100
      ))
    const cards = listReady
      ? await picker.webContents.executeJavaScript("document.querySelectorAll('.ov-card').length")
      : 0
    const previewReady =
      cards > 0 &&
      (await until(
        'first lazy window preview',
        () =>
          picker.webContents.executeJavaScript(
            "Boolean(document.querySelector('.ov-card-shot img'))"
          ),
        8000,
        100
      ))
    closeOverlay(null)
    await selection
    if (!listReady || !previewReady) return false
    log(`window: PASS (one picker, ${cards} window card${cards === 1 ? '' : 's'}, lazy preview verified)`)
    return true
  } finally {
    closeOverlay(null)
    if (!target.isDestroyed()) target.destroy()
  }
}

/** A deterministic labelled test card, generated without any capture permission. */
function makeTestImage(width: number, height: number): string {
  const bmp = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      bmp[i] = (x * 255) / width
      bmp[i + 1] = (y * 255) / height
      bmp[i + 2] = 180
      bmp[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bmp, { width, height }).toDataURL()
}

/* ------------------------------------------------------------------ */

/**
 * A freshly launched (and freshly re-signed) app can't capture for the first several
 * seconds while macOS spins up its ScreenCaptureKit session — variable, 2–20s observed.
 * Gate the suite on a real full-display capture succeeding, so every test measures the
 * app rather than the OS warming up.
 */
async function waitForCaptureReady(): Promise<boolean> {
  const t0 = Date.now()
  const { captureRegionCli, snapshotAllDisplays } = await import('../capture/backend')
  const wanted = screen.getAllDisplays().length
  // Probe with a tiny region shot — hammering the flapping service with the full
  // escalation ladder every second keeps it down. Two consecutive light successes,
  // then one real full-set snapshot to seal it.
  let streak = 0
  const ok = await until(
    'capture service to come up',
    async () => {
      const shot = await captureRegionCli({ x: 0, y: 0, width: 8, height: 8 })
      streak = shot ? streak + 1 : 0
      if (streak < 2) return false
      const snaps = await snapshotAllDisplays()
      return snaps.length >= wanted
    },
    60000,
    1200
  )
  if (ok) log(`capture service ready after ${Date.now() - t0}ms`)
  return ok
}

export async function runSelfTest(which: string): Promise<void> {
  const parts = which.split(',').map((s) => s.trim().toLowerCase())
  const results: Array<[string, boolean]> = []

  try {
    const needsStillCapture =
      parts.includes('all') ||
      parts.includes('latency') ||
      parts.includes('quick') ||
      parts.includes('pipeline')
    if (needsStillCapture && !(await waitForCaptureReady())) {
      log('SUMMARY: 0/0 — capture service never became ready')
      return
    }

    // Latency first: it measures the common case — a hotkey press on a quiet system —
    // not the aftermath of a recording stress marathon. The heavy phases follow, with
    // settle time between them because the OS capture service needs a beat after each.
    if (parts.includes('latency') || parts.includes('all')) {
      results.push(['latency', await testLatency()])
      await wait(2500)
    }
    if (parts.includes('window') || parts.includes('all')) {
      results.push(['window', await testWindowPicker()])
      await wait(500)
    }
    if (parts.includes('pin') || parts.includes('all')) {
      results.push(['pin', await testPin()])
    }
    if (parts.includes('quick') || parts.includes('all')) {
      results.push(['quick', await testQuickAccess()])
      await wait(1500)
    }
    if (parts.includes('pipeline') || parts.includes('all')) {
      results.push(['pipeline', await testPipeline()])
      await wait(3000)
    }
    if (parts.includes('scroll') || parts.includes('all')) {
      results.push(['scroll', await testScroll()])
      await wait(2000)
    }
    if (parts.includes('recording') || parts.includes('all')) {
      results.push(['recording/MP4', await testRecording('MP4')])
      await wait(1500)
      results.push(['recording/GIF', await testRecording('GIF')])
      await wait(1500)
    }
    if (parts.includes('zoom') || parts.includes('all')) {
      results.push(['recording/zoom', await testAutoZoomPixels()])
    }
  } catch (err) {
    fail(`unhandled: ${(err as Error).stack ?? err}`)
  }

  const passed = results.filter(([, ok]) => ok).length
  log(`SUMMARY: ${passed}/${results.length} passed — ${results.map(([n, ok]) => `${n}=${ok ? 'PASS' : 'FAIL'}`).join(', ')}`)
}
