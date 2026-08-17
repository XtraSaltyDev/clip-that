import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, desktopCapturer, nativeImage, screen } from 'electron'
import type { DisplaySnapshot, WindowInfo } from '@shared/types'
import { editorWindows } from '../windows/manager'
import { displayPixelSize, findDisplay } from './displays'
import { shouldIncludeWindowSource } from './window-sources'

const IS_MAC = process.platform === 'darwin'

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

async function tempPng(): Promise<string> {
  return join(tmpdir(), `clipthat-${randomUUID()}.png`)
}

function windowInfoHelper(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'build', 'clipthat-window-info')
    : join(app.getAppPath(), 'build', 'clipthat-window-info')
}

function overlapArea(a: Electron.Rectangle, b: Electron.Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

/** Resolve a desktopCapturer window id to global-DIP geometry without Accessibility access. */
export async function windowInfo(windowId: string): Promise<WindowInfo | undefined> {
  if (!IS_MAC) return undefined
  const cgWindowId = windowId.split(':')[1]
  if (!cgWindowId || !/^\d+$/.test(cgWindowId)) return undefined

  try {
    const raw = JSON.parse(await run(windowInfoHelper(), [cgWindowId])) as {
      x: number
      y: number
      width: number
      height: number
      owner?: string
      title?: string
    }
    const bounds = { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return undefined
    if (bounds.width <= 0 || bounds.height <= 0) return undefined
    const display = screen.getAllDisplays().sort(
      (a, b) => overlapArea(b.bounds, bounds) - overlapArea(a.bounds, bounds)
    )[0]
    return {
      id: windowId,
      title: raw.title?.trim() || raw.owner?.trim() || 'Window',
      appName: raw.owner?.trim() || 'Window',
      bounds,
      displayId: display ? String(display.id) : undefined
    }
  } catch (error) {
    console.warn('[clipthat] window geometry unavailable', (error as Error).message)
    return undefined
  }
}

/**
 * The display a capture source belongs to.
 *
 * `display_id` is the documented field but macOS frequently returns it empty. The source
 * `id` is `screen:<CGDirectDisplayID>:0`, and `screen.getAllDisplays()` reports that same
 * CGDirectDisplayID, so parsing it out is a reliable second route.
 */
function sourceDisplayId(source: Electron.DesktopCapturerSource): string | null {
  if (source.display_id) return source.display_id
  const match = /^screen:(\d+):/.exec(source.id)
  return match ? match[1] : null
}

/**
 * Grab every screen in one `getSources` call.
 *
 * Asking once per display size looks tidier and produces exactly-sized thumbnails, but
 * back-to-back calls make macOS return empty thumbnails for every display but the first —
 * so a second monitor silently ended up with no snapshot, and therefore no overlay.
 *
 * Instead we ask once at a box big enough for the largest display. Electron fits each
 * thumbnail inside that box preserving aspect, so every display comes back at or above its
 * native resolution, and we downscale to native afterwards.
 */
async function grabScreenSources(): Promise<Map<string, Electron.NativeImage>> {
  const displays = screen.getAllDisplays()
  const box = displays.reduce(
    (acc, d) => {
      const s = displayPixelSize(d)
      return { width: Math.max(acc.width, s.width), height: Math.max(acc.height, s.height) }
    },
    { width: 1280, height: 720 }
  )

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: box,
    fetchWindowIcons: false
  })

  const byDisplay = new Map<string, Electron.NativeImage>()
  const claimed = new Set<string>()

  for (const d of displays) {
    const wanted = String(d.id)
    const source =
      sources.find((s) => !claimed.has(s.id) && sourceDisplayId(s) === wanted) ??
      // Positional last resort: better a snapshot of the wrong screen than no overlay.
      sources.find((s) => !claimed.has(s.id))
    if (!source || source.thumbnail.isEmpty()) continue
    claimed.add(source.id)

    const native = displayPixelSize(d)
    const size = source.thumbnail.getSize()
    byDisplay.set(
      wanted,
      size.width === native.width && size.height === native.height
        ? source.thumbnail
        : source.thumbnail.resize({ ...native, quality: 'best' })
    )
  }

  return byDisplay
}

export async function snapshotAllDisplays(): Promise<DisplaySnapshot[]> {
  const displays = screen.getAllDisplays()
  const t0 = Date.now()

  /*
   * Two capture paths with opposite failure modes:
   *   - desktopCapturer is fast (~200ms, GPU path) but intermittently returns empty
   *     thumbnails or hangs for seconds.
   *   - the `screencapture` CLI is trustworthy but pays a PNG encode/decode round-trip
   *     (~1–2.5s for a Retina display), and very occasionally fails transiently.
   *
   * So: give the fast path a short budget; every failure it can produce is detectable
   * (missing display, empty thumbnail), so falling through is always safe. The CLI
   * gets one retry because its failures are transient.
   */
  const cliShots = new Map<string, CliShot>()
  const images = new Map<string, Electron.NativeImage>()
  const absorb = (from: Map<string, Electron.NativeImage>) => {
    for (const [id, img] of from) if (!images.has(id)) images.set(id, img)
  }
  const complete = () => new Set([...cliShots.keys(), ...images.keys()]).size >= displays.length

  /*
   * One path at a time, never overlapping. A timeout that abandons a desktopCapturer
   * request does not cancel it — the request keeps running, holding the OS capture
   * service, and everything started afterwards contends with it. Racing the two paths
   * made a 0.7s capture take 10s.
   *
   * macOS leads with `screencapture -R` per display. Elsewhere desktopCapturer is the
   * only option.
   */
  const path: string[] = []
  if (IS_MAC) {
    path.push('cli')
    for (const [id, shot] of await grabScreensViaCli()) cliShots.set(id, shot)
  }
  if (!complete()) {
    path.push('dc')
    absorb(await grabScreenSources().catch(() => new Map<string, Electron.NativeImage>()))
  }

  console.log(
    `[clipthat] snapshot: ${new Set([...cliShots.keys(), ...images.keys()]).size}/${displays.length} ` +
      `via ${path.join('→')} in ${Date.now() - t0}ms`
  )

  const results: DisplaySnapshot[] = []
  for (const d of displays) {
    const cliShot = cliShots.get(String(d.id))
    if (cliShot) {
      results.push({
        displayId: String(d.id),
        dataUrl: cliShot.dataUrl,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
        pixelWidth: cliShot.width,
        pixelHeight: cliShot.height
      })
      continue
    }
    const image = images.get(String(d.id))
    if (!image) {
      console.warn(`[clipthat] no snapshot for display ${d.id} — it will have no overlay`)
      continue
    }
    const size = image.getSize()
    results.push({
      displayId: String(d.id),
      dataUrl: image.toDataURL(),
      bounds: { ...d.bounds },
      scaleFactor: d.scaleFactor,
      pixelWidth: size.width,
      pixelHeight: size.height
    })
  }

  return results
}

/**
 * Freeze the display under the pointer first, then the remaining displays in order.
 *
 * Region selection only needs one frozen image before it can become useful.  On macOS a
 * full-resolution `screencapture -R` is necessarily serial, so making callers wait for
 * every monitor turned a second monitor into a multi-second delay on the first one.
 * `remaining` deliberately stays serial: concurrent ScreenCaptureKit requests are both
 * slower and materially less reliable.
 */
export async function beginOverlaySnapshots(primaryDisplayId: string): Promise<{
  initial: DisplaySnapshot | null
  remaining: Promise<DisplaySnapshot[]>
}> {
  const displays = screen.getAllDisplays()
  const primary = displays.find((display) => String(display.id) === primaryDisplayId)
  if (!primary) return { initial: null, remaining: Promise.resolve([]) }

  // The specialised path is for macOS, where the CLI gives us reliable native pixels.
  // Other platforms retain their existing single compositor request.
  if (!IS_MAC) {
    const all = await snapshotAllDisplays()
    return {
      initial: all.find((snapshot) => snapshot.displayId === primaryDisplayId) ?? null,
      remaining: Promise.resolve(all.filter((snapshot) => snapshot.displayId !== primaryDisplayId))
    }
  }

  const initial = await captureDisplay(primaryDisplayId)
  const remaining = (async () => {
    const snapshots: DisplaySnapshot[] = []
    for (const display of displays) {
      if (String(display.id) === primaryDisplayId) continue
      const snapshot = await captureDisplay(String(display.id))
      if (snapshot) snapshots.push(snapshot)
    }
    return snapshots
  })()
  return { initial, remaining }
}

/**
 * Capture each display with `screencapture -R <its bounds>`.
 *
 * Region coordinates are global desktop points, so a display at a negative origin is
 * captured correctly, and Retina displays come back at native pixel size.
 */
interface CliShot {
  dataUrl: string
  width: number
  height: number
}

async function cliShotAll(): Promise<Map<string, CliShot>> {
  const displays = screen.getAllDisplays()
  const byDisplay = new Map<string, CliShot>()

  // Sequential, measured: running the region shots concurrently doubled total latency
  // (1.7s → 3.4s). They contend for the one capture service rather than overlapping,
  // and two processes competing is slower than two taking turns.
  for (const d of displays) {
    const shot = await captureRegionCli(d.bounds)
    if (shot) byDisplay.set(String(d.id), shot)
  }
  return byDisplay
}

async function grabScreensViaCli(): Promise<Map<string, CliShot>> {
  const displays = screen.getAllDisplays()
  const byDisplay = await cliShotAll()
  console.log(`[clipthat] cli snapshots: ${byDisplay.size}/${displays.length} displays`)
  return byDisplay
}

/** One display via its bounds — a single region shot, no full-desktop pass. */
async function cliShotForDisplay(displayId: string): Promise<CliShot | null> {
  const d = findDisplay(displayId)
  if (!d) return null
  const shot = await captureRegionCli(d.bounds)
  if (shot) return shot
  return (await grabScreensViaCli()).get(displayId) ?? null
}

/**
 * Capture a region directly, given in global desktop DIPs.
 *
 * `screencapture -R` grabs just those points (returning native pixels on Retina), which
 * is what makes 2–3 fps scroll capture possible: photographing and decoding the whole
 * 3024x1964 display per frame managed roughly one frame every three seconds.
 */
export async function captureRegionCli(
  rect: { x: number; y: number; width: number; height: number }
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!IS_MAC) return null
  const file = await tempPng()
  try {
    const spec = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`
    await run('screencapture', ['-x', '-o', '-t', 'png', `-R${spec}`, file])
    const png = await fs.readFile(file)
    const img = nativeImage.createFromBuffer(png)
    if (img.isEmpty()) return null
    const size = img.getSize()
    // `screencapture` already gave us a PNG. Base64-wrap those exact bytes instead of
    // asking NativeImage to decode and PNG-encode the same pixels again.
    return {
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      width: size.width,
      height: size.height
    }
  } catch (err) {
    console.warn(`[clipthat] screencapture -R failed: ${(err as Error).message}`)
    return null
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
  }
}

/** Full-resolution capture of a single display. */
export async function captureDisplay(displayId: string): Promise<DisplaySnapshot | null> {
  const d = findDisplay(displayId)
  if (!d) return null

  // Same reasoning as snapshotAllDisplays: on this platform the CLI is the reliable
  // path and desktopCapturer is the one that intermittently lies.
  if (IS_MAC) {
    const shot = await cliShotForDisplay(displayId)
    if (shot) {
      return {
        displayId,
        dataUrl: shot.dataUrl,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
        pixelWidth: shot.width,
        pixelHeight: shot.height
      }
    }

    // Native region capture is an optimization, not a correctness requirement. Retain
    // the same ScreenCaptureKit-backed fallback used by the all-display snapshot path.
    const image = (
      await grabScreenSources().catch(() => new Map<string, Electron.NativeImage>())
    ).get(displayId)
    if (!image) return null
    const size = image.getSize()
    return {
      displayId,
      dataUrl: image.toDataURL(),
      bounds: { ...d.bounds },
      scaleFactor: d.scaleFactor,
      pixelWidth: size.width,
      pixelHeight: size.height
    }
  }

  const { width, height } = displayPixelSize(d)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  const source =
    sources.find((s) => s.display_id === displayId) ??
    (sources.length === 1 ? sources[0] : undefined)
  if (!source || source.thumbnail.isEmpty()) {
    const all = await snapshotAllDisplays()
    return all.find((s) => s.displayId === displayId) ?? null
  }
  const size = source.thumbnail.getSize()
  return {
    displayId,
    dataUrl: source.thumbnail.toDataURL(),
    bounds: { ...d.bounds },
    scaleFactor: d.scaleFactor,
    pixelWidth: size.width,
    pixelHeight: size.height
  }
}

/**
 * Enumerate capturable windows, frontmost first as reported by the OS.
 * `withPreview` costs a compositor round-trip per window, so the picker asks for it
 * and everything else doesn't.
 */
export async function listWindows(withPreview = true): Promise<WindowInfo[]> {
  const t0 = Date.now()
  const visibleEditors = editorWindows().filter((win) => win.isVisible())
  const visibleEditorTitles = visibleEditors.map((win) => win.getTitle())
  const visibleEditorSourceIds = visibleEditors.map((win) => win.getMediaSourceId())
  // On macOS, asking ScreenCaptureKit to materialize every preview can hang the entire
  // enumeration. Return metadata immediately and let the picker request native previews
  // one at a time. Windows and Linux keep the efficient batched compositor path.
  const batchPreviews = withPreview && !IS_MAC
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    // Cards render at roughly 220x124. This remains Retina-sharp without asking the
    // compositor to allocate 480x320 for every open window.
    thumbnailSize: batchPreviews ? { width: 440, height: 248 } : { width: 0, height: 0 },
    // Electron only implements app icons on Windows and Linux. Asking for them on macOS
    // adds work to an already fragile ScreenCaptureKit enumeration and yields no icon.
    fetchWindowIcons: batchPreviews
  })
  const windows = sources
    .filter((s) =>
      shouldIncludeWindowSource(s.name, visibleEditorTitles, s.id, visibleEditorSourceIds)
    )
    .map((s) => {
      // Electron reports "AppName — Document" on macOS and just the title elsewhere.
      const [head, ...rest] = s.name.split(' — ')
      const icon = s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined
      return {
        id: s.id,
        title: rest.length ? rest.join(' — ') : s.name,
        appName: rest.length ? head : s.name,
        thumbnail:
          batchPreviews && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : undefined,
        icon
      }
    })
  console.log(
    `[clipthat] windows: ${windows.length} source(s), previews=${batchPreviews ? 'batch' : 'lazy'} in ${Date.now() - t0}ms`
  )
  return windows
}

/** Load one picker preview without allocating thumbnails for every open window. */
export async function windowPreview(windowId: string): Promise<string | undefined> {
  if (IS_MAC) {
    const cgWindowId = windowId.split(':')[1]
    if (!cgWindowId || !/^\d+$/.test(cgWindowId)) return undefined
    const file = await tempPng()
    try {
      await run('screencapture', ['-x', '-o', '-t', 'png', `-l${cgWindowId}`, file])
      let image = nativeImage.createFromBuffer(await fs.readFile(file))
      if (image.isEmpty()) return undefined
      const size = image.getSize()
      const scale = Math.min(1, 440 / size.width, 248 / size.height)
      if (scale < 1) {
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'good'
        })
      }
      return image.toDataURL()
    } catch {
      return undefined
    } finally {
      await fs.rm(file, { force: true }).catch(() => {})
    }
  }

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 440, height: 248 },
    fetchWindowIcons: false
  })
  const source = sources.find((item) => item.id === windowId)
  return source && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : undefined
}

/**
 * Capture one window.
 *
 * On macOS the `desktopCapturer` window id embeds the CGWindowID, so we hand it to
 * `screencapture -l` and get a true native-resolution grab (correct alpha corners, no shadow).
 * Elsewhere we ask `desktopCapturer` for a generously sized thumbnail.
 */
export async function captureWindow(
  windowId: string
): Promise<{ dataUrl: string; width: number; height: number; title: string } | null> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  })
  const meta = sources.find((s) => s.id === windowId)
  const title = meta?.name ?? 'Window'

  if (IS_MAC) {
    const cgWindowId = windowId.split(':')[1]
    if (cgWindowId && /^\d+$/.test(cgWindowId)) {
      const file = await tempPng()
      try {
        await run('screencapture', ['-x', '-o', '-t', 'png', `-l${cgWindowId}`, file])
        const buf = await fs.readFile(file)
        const img = nativeImage.createFromBuffer(buf)
        if (!img.isEmpty()) {
          const size = img.getSize()
          return { dataUrl: img.toDataURL(), width: size.width, height: size.height, title }
        }
      } catch {
        // fall through to desktopCapturer
      } finally {
        await fs.rm(file, { force: true }).catch(() => {})
      }
    }
  }

  // Ask for a thumbnail larger than any real window so the compositor gives us 1:1 pixels.
  const maxPx = screen.getAllDisplays().reduce(
    (acc, d) => {
      const s = displayPixelSize(d)
      return { width: Math.max(acc.width, s.width), height: Math.max(acc.height, s.height) }
    },
    { width: 1920, height: 1080 }
  )
  const full = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: maxPx
  })
  const source = full.find((s) => s.id === windowId)
  if (!source || source.thumbnail.isEmpty()) return null
  const size = source.thumbnail.getSize()
  return { dataUrl: source.thumbnail.toDataURL(), width: size.width, height: size.height, title }
}
