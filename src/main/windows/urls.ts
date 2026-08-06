import { join } from 'node:path'

export type RendererEntry = 'editor' | 'overlay' | 'library' | 'hud' | 'settings'

const devServer = process.env['ELECTRON_RENDERER_URL']

/** Resolve a renderer entry to a dev-server URL or a packaged file path. */
export function rendererUrl(entry: RendererEntry, hash = ''): { url?: string; file?: string; hash: string } {
  if (devServer) return { url: `${devServer}/${entry}.html`, hash }
  return { file: join(__dirname, `../renderer/${entry}.html`), hash }
}

export function loadEntry(win: Electron.BrowserWindow, entry: RendererEntry, hash = ''): void {
  const target = rendererUrl(entry, hash)
  if (target.url) {
    void win.loadURL(hash ? `${target.url}#${hash}` : target.url)
  } else {
    void win.loadFile(target.file!, hash ? { hash } : undefined)
  }
}

export const preloadPath = () => join(__dirname, '../preload/index.js')
