import { BrowserWindow, clipboard, dialog, nativeImage, shell } from 'electron'
import { existsSync, writeFileSync, promises as fs } from 'node:fs'
import { join, extname, basename } from 'node:path'
import type { ClipDocument, PrintResult, SaveImageRequest, SaveResult } from '@shared/types'
import { formatFilename, safeFilename } from '@shared/defaults'
import { nsFilenamesPlist } from '@shared/file-clipboard'
import { imagePrintHtml, isPrintCancellation } from '@shared/print'
import { settings } from './store/settings'
import { tempDir } from './store/paths'
import { clipDocument } from './ipc/validation'

const EXT_FILTERS: Record<string, Electron.FileFilter> = {
  png: { name: 'PNG image', extensions: ['png'] },
  jpg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  webp: { name: 'WebP image', extensions: ['webp'] }
}

/** Ensure a path ends in `.ext`, and never collides with an existing file. */
async function uniquePath(dir: string, name: string, ext: string): Promise<string> {
  let candidate = join(dir, `${name}.${ext}`)
  let n = 2
  while (true) {
    try {
      await fs.access(candidate)
      candidate = join(dir, `${name} ${n}.${ext}`)
      n++
    } catch {
      return candidate
    }
  }
}

function bufferFor(dataUrl: string, format: 'png' | 'jpg' | 'webp'): Buffer {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (format === 'jpg') return image.toJPEG(settings.get().jpegQuality)
  if (format === 'png') return image.toPNG()
  // Electron has no WebP encoder; the renderer already produced a WebP data URL for us.
  const comma = dataUrl.indexOf(',')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

export async function saveImage(req: SaveImageRequest): Promise<SaveResult> {
  const s = settings.get()
  const format = req.format ?? s.imageFormat
  const name = safeFilename(req.suggestedName?.trim() || formatFilename(s.filenameTemplate))

  let target: string
  if (req.saveAs) {
    const res = await dialog.showSaveDialog({
      title: 'Save capture',
      defaultPath: join(s.saveDirectory, `${name}.${format}`),
      filters: [EXT_FILTERS[format], { name: 'All files', extensions: ['*'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    target = res.filePath
  } else if (req.targetPath) {
    target = req.targetPath
  } else {
    await fs.mkdir(s.saveDirectory, { recursive: true }).catch(() => {})
    target = await uniquePath(s.saveDirectory, name, format)
  }

  try {
    await fs.writeFile(target, bufferFor(req.dataUrl, format))
    if (req.project) {
      const projectPath = target.replace(extname(target), '.clipthat')
      await fs.writeFile(projectPath, JSON.stringify(req.project), 'utf8')
    }
    if (s.copyOnSave && !req.saveAs) {
      clipboard.writeImage(nativeImage.createFromDataURL(req.dataUrl))
    }
    return { ok: true, filePath: target, title: basename(target, extname(target)) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function copyImageToClipboard(dataUrl: string): boolean {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return false
  clipboard.writeImage(image)
  return true
}

/** Put a real file on the pasteboard so Finder and other apps can paste it. */
export function copyFileToClipboard(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  if (process.platform === 'darwin') {
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(nsFilenamesPlist([filePath])))
    return true
  }
  clipboard.write({ text: filePath })
  return true
}

export function readImageFromClipboard(): {
  dataUrl: string
  width: number
  height: number
} | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const size = image.getSize()
  return { dataUrl: image.toDataURL(), width: size.width, height: size.height }
}

export async function saveProject(doc: ClipDocument, saveAs = true): Promise<SaveResult> {
  const s = settings.get()
  const name = safeFilename(doc.title || formatFilename(s.filenameTemplate))
  let target: string
  if (saveAs) {
    const res = await dialog.showSaveDialog({
      title: 'Save ClipThat project',
      defaultPath: join(s.saveDirectory, `${name}.clipthat`),
      filters: [{ name: 'ClipThat project', extensions: ['clipthat'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    target = res.filePath
  } else {
    target = await uniquePath(s.saveDirectory, name, 'clipthat')
  }
  try {
    await fs.writeFile(target, JSON.stringify(doc), 'utf8')
    return { ok: true, filePath: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function openProjectDialog(): Promise<ClipDocument | null> {
  const res = await dialog.showOpenDialog({
    title: 'Open ClipThat project',
    filters: [
      { name: 'ClipThat project', extensions: ['clipthat'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ],
    properties: ['openFile']
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return loadProjectFile(res.filePaths[0])
}

export async function loadProjectFile(filePath: string): Promise<ClipDocument | null> {
  try {
    if (extname(filePath).toLowerCase() === '.clipthat') {
      return clipDocument(JSON.parse(await fs.readFile(filePath, 'utf8')))
    }
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return null
    const size = image.getSize()
    const s = settings.get()
    return {
      version: 1,
      id: `import-${Date.now()}`,
      title: basename(filePath, extname(filePath)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      image: image.toDataURL(),
      imageWidth: size.width,
      imageHeight: size.height,
      scaleFactor: 1,
      crop: { enabled: false, x: 0, y: 0, width: size.width, height: size.height },
      shapes: [],
      canvas: { ...s.canvasPreset }
    }
  } catch {
    return null
  }
}

/**
 * Render an image to PDF by printing a throwaway page.
 * Electron's `printToPDF` is the only PDF writer available without pulling in a native lib.
 */
export async function exportPdf(dataUrl: string, suggestedName?: string): Promise<SaveResult> {
  const s = settings.get()
  const res = await dialog.showSaveDialog({
    title: 'Export PDF',
    defaultPath: join(
      s.saveDirectory,
      `${safeFilename(suggestedName || formatFilename(s.filenameTemplate))}.pdf`
    ),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }

  const image = nativeImage.createFromDataURL(dataUrl)
  const { width, height } = image.getSize()

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true, sandbox: true }
  })

  try {
    const html = `<!doctype html><meta charset="utf-8"><style>
      @page { margin: 0; }
      html,body { margin:0; padding:0; background:#fff; }
      img { display:block; width:100%; }
    </style><img src="${dataUrl}">`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // Match the page box to the image so nothing is cropped or letterboxed.
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: (width / 96) * 25400, height: (height / 96) * 25400 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    await fs.writeFile(res.filePath, pdf)
    return { ok: true, filePath: res.filePath }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Print the flattened editor capture through the native system dialog. */
export async function printImage(
  dataUrl: string,
  suggestedName?: string,
  parent?: BrowserWindow | null
): Promise<PrintResult> {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return { ok: false, error: 'The rendered capture could not be decoded' }

  const { width, height } = image.getSize()
  const title = safeFilename(suggestedName?.trim() || 'ClipThat capture')
  const win = new BrowserWindow({
    show: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    width: 800,
    height: 600,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    const html = imagePrintHtml(dataUrl, title)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    return await new Promise<PrintResult>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          landscape: width > height,
          margins: { marginType: 'printableArea' },
          usePrinterDefaultPageSize: true
        },
        (success, failureReason) => {
          if (success) resolve({ ok: true })
          else if (isPrintCancellation(failureReason)) resolve({ ok: false, canceled: true })
          else resolve({ ok: false, error: failureReason || 'The print job failed' })
        }
      )
    })
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Write a temp PNG and hand it to the OS drag-and-drop pipeline. */
export function startDrag(
  event: { sender: Electron.WebContents },
  dataUrl: string,
  name: string
): void {
  const image = nativeImage.createFromDataURL(dataUrl)
  const file = join(tempDir(), `${safeFilename(name)}.png`)
  writeFileSync(file, image.toPNG())
  const size = image.getSize()
  const scale = Math.min(1, 160 / Math.max(size.width, size.height, 1))
  event.sender.startDrag({
    file,
    icon: image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale))
    })
  })
}

/** Hand an existing Library file to the OS drag-and-drop pipeline. */
export function startFileDrag(
  event: { sender: Electron.WebContents },
  filePath: string,
  iconPath?: string
): void {
  if (!existsSync(filePath)) throw new Error('Drag file is no longer available')
  const icon = nativeImage.createFromPath(iconPath ?? filePath)
  event.sender.startDrag({
    file: filePath,
    icon: icon.isEmpty()
      ? nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
      : icon
  })
}

export function revealFile(filePath: string): void {
  shell.showItemInFolder(filePath)
}

export function openFile(filePath: string): Promise<string> {
  return shell.openPath(filePath)
}
