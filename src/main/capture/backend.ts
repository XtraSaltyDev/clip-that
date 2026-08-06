import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { desktopCapturer, nativeImage, screen } from 'electron'
import type { DisplaySnapshot, WindowInfo } from '@shared/types'
import { displayPixelSize, findDisplay } from './displays'

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

  // macOS: the `screencapture` CLI first. It talks to the same capture service as the
  // system screenshot tool, returns true native pixels, and — unlike desktopCapturer,
  // which we have watched time out and return empty thumbnails intermittently at large
  // sizes — it either works or fails with an error we can log.
  let images = IS_MAC ? await grabScreensViaCli() : new Map<string, Electron.NativeImage>()

  if (images.size < displays.length) {
    const dc = await grabScreenSources()
    for (const [id, img] of dc) if (!images.has(id)) images.set(id, img)
  }

  const results: DisplaySnapshot[] = []
  for (const d of displays) {
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
 * One `screencapture -x -D<n>` call per display, each independent: a display that fails
 * is logged and skipped, never allowed to take the others down with it.
 *
 * `-D` is 1-based over CGGetActiveDisplayList, which does not have to match Electron's
 * ordering — so shots are matched back to displays by exact pixel size first, position
 * second. Ambiguity is only possible with identical same-size monitors, where the
 * positional fallback is as good as any other rule.
 */
async function cliShot(dIndex: number): Promise<Electron.NativeImage | null> {
  const file = await tempPng()
  try {
    await run('screencapture', ['-x', '-o', '-t', 'png', `-D${dIndex}`, file])
    const img = nativeImage.createFromBuffer(await fs.readFile(file))
    if (!img.isEmpty()) return img
    console.warn(`[clipthat] screencapture -D${dIndex}: wrote an empty image`)
    return null
  } catch (err) {
    console.warn(`[clipthat] screencapture -D${dIndex} failed: ${(err as Error).message}`)
    return null
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
  }
}

/**
 * Which `screencapture -D` index photographs which Electron display, learned from the
 * last full pass. Scroll capture photographs one display 2–3 times a second; without
 * this it had to photograph every screen each frame just to pick one out by size.
 * Keyed by the display configuration so plugging or rotating a monitor invalidates it.
 */
const cliIndexCache = new Map<string, number>()
let cliCacheKey = ''

function displayConfigKey(): string {
  return screen
    .getAllDisplays()
    .map((d) => `${d.id}:${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}r${d.rotation}`)
    .join('|')
}

async function grabScreensViaCli(): Promise<Map<string, Electron.NativeImage>> {
  const displays = screen.getAllDisplays()

  // All displays in parallel: sequential calls froze each screen roughly half a second
  // apart, so a window moving between the shots appeared in inconsistent states.
  const shots = (
    await Promise.all(
      displays.map(async (_d, i) => ({ dIndex: i + 1, img: await cliShot(i + 1) }))
    )
  ).filter((s): s is { dIndex: number; img: Electron.NativeImage } => s.img !== null)

  const byDisplay = new Map<string, Electron.NativeImage>()
  const used = new Set<number>()
  cliIndexCache.clear()
  cliCacheKey = displayConfigKey()

  for (const d of displays) {
    const native = displayPixelSize(d)
    let idx = shots.findIndex((s, i) => {
      if (used.has(i)) return false
      const size = s.img.getSize()
      return size.width === native.width && size.height === native.height
    })
    if (idx === -1) idx = shots.findIndex((_, i) => !used.has(i))
    if (idx === -1) continue
    used.add(idx)
    byDisplay.set(String(d.id), shots[idx].img)
    cliIndexCache.set(String(d.id), shots[idx].dIndex)
  }

  console.log(
    `[clipthat] cli snapshots: ${byDisplay.size}/${displays.length} displays` +
      (shots.length !== displays.length ? ` (${shots.length} shots)` : '')
  )
  return byDisplay
}

/** One display, one CLI call — falls back to a full pass when the mapping is unknown. */
async function cliShotForDisplay(displayId: string): Promise<Electron.NativeImage | null> {
  const d = findDisplay(displayId)
  if (!d) return null

  if (cliCacheKey === displayConfigKey()) {
    const dIndex = cliIndexCache.get(displayId)
    if (dIndex !== undefined) {
      const img = await cliShot(dIndex)
      // Trust but verify: the shot must still be this display's pixel size.
      if (img) {
        const size = img.getSize()
        const native = displayPixelSize(d)
        if (size.width === native.width && size.height === native.height) return img
        console.warn(`[clipthat] -D${dIndex} no longer matches display ${displayId}; remapping`)
      }
    }
  }

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
    const img = nativeImage.createFromBuffer(await fs.readFile(file))
    if (img.isEmpty()) return null
    const size = img.getSize()
    return { dataUrl: img.toDataURL(), width: size.width, height: size.height }
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
    const img = await cliShotForDisplay(displayId)
    if (!img) return null
    const size = img.getSize()
    return {
      displayId,
      dataUrl: img.toDataURL(),
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
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: withPreview ? { width: 480, height: 320 } : { width: 0, height: 0 },
    fetchWindowIcons: withPreview
  })
  return sources
    .filter((s) => s.name && !s.name.startsWith('ClipThat'))
    .map((s) => {
      // Electron reports "AppName — Document" on macOS and just the title elsewhere.
      const [head, ...rest] = s.name.split(' — ')
      const icon = s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined
      return {
        id: s.id,
        title: rest.length ? rest.join(' — ') : s.name,
        appName: rest.length ? head : s.name,
        thumbnail:
          withPreview && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : undefined,
        icon
      }
    })
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
