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
import { showHudWindow, getSingleton } from '../windows/manager'
import { captureDisplay } from '../capture/backend'
import { startScrollCapture, finishScrollCapture } from '../capture/service'
import { nativeImage } from 'electron'

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

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

async function testRecording(format: 'MP4' | 'GIF'): Promise<boolean> {
  log(`recording/${format}: starting`)
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

  if (!(await clickButton(hud, 'Start recording'))) {
    fail(`recording/${format}: Start button missing or disabled`)
    return false
  }

  if (!(await until('recorder to reach recording state', () => recording.status().state === 'recording', 25000))) {
    const w = getSingleton('hud')
    const dom = w
      ? await w.webContents
          .executeJavaScript(`document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400)`)
          .catch(() => '(no dom)')
      : '(hud gone)'
    fail(`recording/${format}: main state=${recording.status().state}; hud shows: ${dom}`)
    return false
  }
  log(`recording/${format}: capturing 4s of the primary display`)
  await wait(4000)

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
    fail(`recording/${format}: Save button not found`)
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
    `recording/${format}: ${item.filePath.split('/').pop()} — ` +
      `${stat ? Math.round(stat.size / 1024) : 0} KB, ` +
      `${item.width}x${item.height}, duration=${duration?.toFixed(2) ?? '?'}s, ` +
      `poster=${item.thumbnail ? 'yes' : 'NO'}`
  )

  let ok = true
  if (!stat || stat.size < 20_000) {
    fail(`recording/${format}: file is implausibly small (${stat?.size ?? 0} bytes)`)
    ok = false
  }
  if (duration === null || duration < 2) {
    fail(`recording/${format}: duration ${duration ?? 'unreadable'} — expected ≥ 2s`)
    ok = false
  }

  await library.remove([item.id])
  if (ok) log(`recording/${format}: PASS (artifact deleted)`)
  return ok
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

    // Six deliberate scroll steps, comfortably inside the stitcher's per-frame ceiling.
    for (let step = 1; step <= 6; step++) {
      await wait(900)
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${step * 200})`)
    }
    await wait(900)

    const { scrollFrameCount } = await import('../capture/service')
    const frames = scrollFrameCount()
    log(`scroll: ${frames} frames collected before stitch`)
    if (frames < 4) fail(`scroll: cadence too low — ${frames} frames for 6 scroll steps`)
    const result = await finishScrollCapture()
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
    if (!win.isDestroyed()) win.destroy()
  }
}

/* ------------------------------------------------------------------ */

export async function runSelfTest(which: string): Promise<void> {
  const parts = which.split(',').map((s) => s.trim().toLowerCase())
  const results: Array<[string, boolean]> = []

  try {
    if (parts.includes('recording') || parts.includes('all')) {
      results.push(['recording/MP4', await testRecording('MP4')])
      await wait(1500)
      results.push(['recording/GIF', await testRecording('GIF')])
    }
    if (parts.includes('scroll') || parts.includes('all')) {
      results.push(['scroll', await testScroll()])
    }
  } catch (err) {
    fail(`unhandled: ${(err as Error).stack ?? err}`)
  }

  const passed = results.filter(([, ok]) => ok).length
  log(`SUMMARY: ${passed}/${results.length} passed — ${results.map(([n, ok]) => `${n}=${ok ? 'PASS' : 'FAIL'}`).join(', ')}`)
}
