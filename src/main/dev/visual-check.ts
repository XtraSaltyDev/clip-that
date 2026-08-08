/**
 * Development-only visual check.
 *
 * Renders every window and writes a PNG for each, using `capturePage()` so it works
 * without OS screen-recording permission. Run with:
 *
 *   CLIPTHAT_VISUAL_CHECK=/tmp/shots npm run dev
 *
 * Never loaded unless that variable is set.
 */
import { BrowserWindow, app, screen } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { documentFromCapture, openInEditor } from '../capture/service'
import {
  editorWindows,
  showHudWindow,
  showLibraryWindow,
  showSettingsWindow
} from '../windows/manager'
import { loadEntry, preloadPath } from '../windows/urls'
import { closeOverlay, openOverlay, setOverlayEditorsVisible } from '../windows/overlay'
import { listWindows } from '../capture/backend'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const MOCK = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{font:14px -apple-system,system-ui,sans-serif;background:#f6f7f9;color:#111;height:100vh;display:flex}
.side{width:220px;background:#fff;border-right:1px solid #e5e7eb;padding:16px}
.side h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:10px}
.side a{display:block;padding:8px 10px;border-radius:8px;color:#374151;text-decoration:none;margin-bottom:2px}
.side a.on{background:#eef2ff;color:#4338ca;font-weight:600}
.main{flex:1;padding:24px 28px}
h1{font-size:22px;margin-bottom:4px}
.sub{color:#6b7280;margin-bottom:20px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
th,td{padding:11px 14px;text-align:left;border-bottom:1px solid #f1f3f5;font-size:13px}
th{background:#fafbfc;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;background:#dcfce7;color:#166534;font-size:11px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-top:20px}
code{font-family:ui-monospace,Menlo,monospace;background:#f3f4f6;padding:2px 5px;border-radius:4px;font-size:12px}
</style>
<div class="side">
  <h3>Billing</h3>
  <a class="on">Invoices</a><a>Subscriptions</a><a>Payment methods</a><a>Usage</a>
</div>
<div class="main">
  <h1>Invoices</h1>
  <div class="sub">Account owner: dana.whitfield@northgate-labs.com</div>
  <table>
    <tr><th>Invoice</th><th>Customer</th><th>Card</th><th>Amount</th><th>Status</th></tr>
    <tr><td>INV-20841</td><td>Marcus Bell</td><td>4539 1488 0343 6467</td><td>$1,240.00</td><td><span class="pill">Paid</span></td></tr>
    <tr><td>INV-20842</td><td>Priya Raman</td><td>6011 1111 1111 1117</td><td>$318.50</td><td><span class="pill">Paid</span></td></tr>
    <tr><td>INV-20843</td><td>Toby Alvarez</td><td>3782 822463 10005</td><td>$96.00</td><td><span class="pill">Paid</span></td></tr>
  </table>
  <div class="card">
    <b>API access</b><br><br>
    Docs: https://docs.northgate-labs.com/api/v2 &nbsp; Server: <code>10.42.18.203</code><br>
    Support line: <code>+1 415 555 0182</code> &nbsp; Brand: <code>#4F8CFF</code><br><br>
    Secret key: <code>sk-P7xQm2Rv9LbT4kWzYhNc8Ade</code>
  </div>
</div>`

interface Ctx {
  dir: string
  shot: Electron.NativeImage
}

async function snap(dir: string, name: string, win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  const png = await win.webContents.capturePage()
  await fs.writeFile(join(dir, `${name}.png`), png.toPNG())
}

/** Click a button by its visible label. */
const clickLabel = (win: BrowserWindow, label: string) =>
  win.webContents.executeJavaScript(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b) { b.click(); return true } return false })()`
  )

const clickTip = (win: BrowserWindow, tip: string) =>
  win.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('[data-tip^=' + ${JSON.stringify(JSON.stringify(tip))} + ']'); if (b) { b.click(); return true } return false })()`
  )

function key(win: BrowserWindow, k: string, modifiers: string[] = []): void {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers } as never)
  if (modifiers.length === 0) {
    win.webContents.sendInputEvent({ type: 'char', keyCode: k } as never)
  }
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers } as never)
}

async function drag(
  win: BrowserWindow,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<void> {
  const wc = win.webContents
  wc.sendInputEvent({ type: 'mouseDown', x: x1, y: y1, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    wc.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(x1 + ((x2 - x1) * i) / 8),
      y: Math.round(y1 + ((y2 - y1) * i) / 8),
      button: 'left'
    })
    await wait(22)
  }
  wc.sendInputEvent({ type: 'mouseUp', x: x2, y: y2, button: 'left', clickCount: 1 })
  await wait(140)
}

async function makeSourceImage(dir: string): Promise<Electron.NativeImage> {
  const mock = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { sandbox: true }
  })
  await mock.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(MOCK)}`)
  await wait(700)
  const shot = await mock.webContents.capturePage()
  await fs.writeFile(join(dir, '00-source.png'), shot.toPNG())
  mock.destroy()
  return shot
}

async function checkEditor({ dir, shot }: Ctx): Promise<void> {
  const size = shot.getSize()
  openInEditor(
    documentFromCapture({
      id: 'visual-check',
      dataUrl: shot.toDataURL(),
      width: size.width,
      height: size.height,
      scaleFactor: 1,
      source: 'window',
      createdAt: Date.now(),
      title: 'Billing dashboard'
    })
  )
  await wait(2800)
  const editor = editorWindows()[0]
  if (!editor) return

  await snap(dir, '01-editor', editor)

  key(editor, 'a')
  await drag(editor, 520, 560, 380, 430)
  key(editor, 'r')
  await drag(editor, 300, 380, 620, 420)
  key(editor, 's')
  editor.webContents.sendInputEvent({ type: 'mouseDown', x: 660, y: 400, button: 'left', clickCount: 1 })
  editor.webContents.sendInputEvent({ type: 'mouseUp', x: 660, y: 400, button: 'left', clickCount: 1 })
  await wait(400)
  await snap(dir, '02-annotated', editor)

  await clickLabel(editor, 'Beautify')
  await wait(900)
  await snap(dir, '03-beautified', editor)

  // Command palette
  key(editor, 'k', ['cmd'])
  await wait(500)
  await snap(dir, '04-palette', editor)
  key(editor, 'Escape')
  await wait(300)

  // Screen-context panel (OCR-backed)
  await clickTip(editor, 'Screen context')
  await wait(24000)
  await snap(dir, '05-context', editor)

  await clickLabel(editor, 'Blur all')
  await wait(1200)
  await snap(dir, '06-redacted', editor)

  await clickLabel(editor, 'Save')
  await wait(3000)
  await snap(dir, '07-saved', editor)
}

async function checkOverlay({ dir, shot }: Ctx): Promise<void> {
  const size = shot.getSize()
  const overlay = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true }
  })
  loadEntry(overlay, 'overlay')
  await new Promise<void>((r) => overlay.webContents.once('did-finish-load', () => r()))
  overlay.webContents.send(IPC.captureOverlayInit, {
    mode: 'region',
    snapshot: {
      displayId: 'mock',
      dataUrl: shot.toDataURL(),
      bounds: { x: 0, y: 0, width: 1280, height: 800 },
      scaleFactor: 2,
      pixelWidth: size.width,
      pixelHeight: size.height
    },
    displayCount: 1,
    editorVisibility: { available: true, visible: true }
  })
  overlay.showInactive()
  await wait(1400)

  overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 520, y: 300 })
  await wait(500)
  await snap(dir, '10-overlay-loupe', overlay)

  overlay.webContents.send(IPC.captureOverlayUpdate, {
    editorVisibility: { available: true, visible: false }
  })
  await wait(300)
  await snap(dir, '10b-overlay-editor-hidden', overlay)
  overlay.webContents.send(IPC.captureOverlayUpdate, {
    editorVisibility: { available: true, visible: true }
  })
  await wait(300)

  await drag(overlay, 340, 250, 700, 450)
  await wait(400)
  await snap(dir, '11-overlay-selection', overlay)
  overlay.destroy()
}

/** Optional physical-screen check for editor inclusion and the alternate hidden scene. */
async function checkLiveEditorOverlay({ dir }: Ctx): Promise<void> {
  const editor = editorWindows()[0]
  if (!editor) throw new Error('live overlay check needs an open editor')
  editor.show()
  editor.focus()
  await wait(400)
  const editorDisplayId = screen.getDisplayMatching(editor.getBounds()).id

  let editorCandidate = false
  for (let attempt = 0; attempt < 5 && !editorCandidate; attempt++) {
    const candidates = await listWindows(false)
    editorCandidate = candidates.some(
      (candidate) => candidate.title === 'ClipThat' || candidate.appName === 'ClipThat'
    )
    if (!editorCandidate) await wait(750)
  }
  if (!editorCandidate) throw new Error('visible editor was missing from the window picker')

  const selection = openOverlay('region')
  let overlay: BrowserWindow | undefined
  for (let attempt = 0; attempt < 300; attempt++) {
    overlay = BrowserWindow.getAllWindows().find(
      (candidate) =>
        candidate.isVisible() &&
        candidate.webContents.getURL().includes('/overlay.html') &&
        screen.getDisplayMatching(candidate.getBounds()).id === editorDisplayId
    )
    if (overlay) break
    await wait(100)
  }

  try {
    if (!overlay) throw new Error('live capture overlay did not appear')
    await wait(500)
    await snap(dir, '17-live-overlay-editor-visible', overlay)

    const hidden = await setOverlayEditorsVisible(overlay, false)
    if (!hidden.available || hidden.visible) throw new Error('editor did not enter the hidden state')
    await wait(400)
    await snap(dir, '18-live-overlay-editor-hidden', overlay)

    const visible = await setOverlayEditorsVisible(overlay, true)
    if (!visible.visible) throw new Error('editor did not return to the visible state')
  } finally {
    closeOverlay(null)
    await selection
  }
}

export async function runVisualCheck(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })

  app.on('web-contents-created', (_e, contents) => {
    contents.on('console-message', (_ev, level, message, line, source) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${source}:${line})`)
    })
    contents.on('render-process-gone', (_ev, details) =>
      console.log('[renderer gone]', JSON.stringify(details))
    )
    contents.on('preload-error', (_ev, path, error) =>
      console.log('[preload error]', path, error.message)
    )
  })

  const shot = await makeSourceImage(dir)
  const ctx: Ctx = { dir, shot }

  await checkEditor(ctx)

  // Seed a few dated entries so the timeline grouping has something to show.
  const { library: libraryStore } = await import('../store/library')
  const day = 86_400_000
  const seeds: Array<[string, number]> = [
    ['Signup flow', 0],
    ['Deploy logs', day],
    ['Design review', day * 4],
    ['Q3 roadmap', day * 40]
  ]
  for (const [title, age] of seeds) {
    const item = await libraryStore.addImage({
      dataUrl: shot.toDataURL(),
      title,
      width: shot.getSize().width,
      height: shot.getSize().height
    })
    libraryStore.setCreatedAtForVisualCheck(item.id, Date.now() - age)
  }

  await wait(900)
  const seededEditor = editorWindows()[0]
  if (seededEditor) {
    await snap(dir, '07b-editor-library-strip', seededEditor)
    const editorCount = editorWindows().length
    const clicked = await seededEditor.webContents.executeJavaScript(
      `(() => {
        const target = [...document.querySelectorAll('.editor-library-item')]
          .find((button) => button.getAttribute('aria-label')?.endsWith('Signup flow'));
        if (!target) return false;
        target.click();
        return true;
      })()`
    )
    if (!clicked) throw new Error('editor Library strip did not contain the newest seed')
    await wait(900)
    const activeTitle = await seededEditor.webContents.executeJavaScript(
      `document.querySelector('.title-input')?.value ?? ''`
    )
    if (activeTitle !== 'Signup flow') throw new Error('Library strip did not switch the editor item')
    if (editorWindows().length !== editorCount) throw new Error('Library strip opened another editor')
    await snap(dir, '07c-editor-library-switched', seededEditor)
  }

  const library = showLibraryWindow()
  await wait(2400)
  await snap(dir, '08-library', library)

  const settings = showSettingsWindow('welcome')
  await wait(1600)
  await snap(dir, '09-settings', settings)
  settings.webContents.send(IPC.settingsNavigate, 'general')
  await wait(500)
  await snap(dir, '09b-settings-library-choice', settings)
  settings.webContents.send(IPC.settingsNavigate, 'about')
  await wait(1200)
  await snap(dir, '09c-settings-about', settings)

  const hud = showHudWindow()
  await wait(1800)
  await snap(dir, '12-recorder', hud)

  // Light theme sweep — the dark theme is the default, so this is the one that rots.
  const { settings: settingsStore } = await import('../store/settings')
  const { broadcast } = await import('../windows/manager')
  settingsStore.set({ theme: 'light' })
  broadcast(IPC.settingsChanged, settingsStore.get())
  await wait(1400)
  const editor = editorWindows()[0]
  if (editor) await snap(dir, '13-editor-light', editor)
  await snap(dir, '14-library-light', library)
  await snap(dir, '15-settings-light', settings)
  settingsStore.set({ theme: 'dark' })
  broadcast(IPC.settingsChanged, settingsStore.get())

  await checkOverlay(ctx)
  if (process.env['CLIPTHAT_LIVE_CAPTURE_CHECK']) await checkLiveEditorOverlay(ctx)

  // Content search: type a word that only appears *inside* the screenshots and
  // confirm the background indexer has made them findable.
  library.show()
  library.focus()
  await library.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.lib-search-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'marcus bell');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true })()`
  )
  await wait(2500)
  await snap(dir, '16-content-search', library)

  const indexed = await library.webContents.executeJavaScript(
    `document.querySelectorAll('.lib-card').length`
  )
  console.log(`[visual-check] content search matched ${indexed} captures`)

  console.log('[visual-check] written to', dir)
}
