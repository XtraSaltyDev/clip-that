import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'

export type RendererRole =
  | 'editor'
  | 'library'
  | 'settings'
  | 'hud'
  | 'overlay'
  | 'quick'
  | 'pin'
  | 'worker'

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent
type InvokeListener = (event: IpcMainInvokeEvent, ...args: any[]) => any
type EventListener = (event: IpcMainEvent, ...args: any[]) => void

const roles = new Map<number, RendererRole>()

/** Register and harden one trusted application renderer before loading its page. */
export function registerRendererWindow(win: BrowserWindow, role: RendererRole): void {
  const webContentsId = win.webContents.id
  roles.set(webContentsId, role)
  win.webContents.once('destroyed', () => roles.delete(webContentsId))

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    const dev = process.env['ELECTRON_RENDERER_URL']
    if ((dev && url.startsWith(dev)) || (current && url === current)) return
    event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

export function rendererRole(event: IpcEvent): RendererRole | undefined {
  return roles.get(event.sender.id)
}

/** Reject unknown windows, child frames, and renderers outside the channel allowlist. */
export function assertIpcSender(event: IpcEvent, allowed: readonly RendererRole[]): RendererRole {
  const role = rendererRole(event)
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!role || !win || win.isDestroyed() || !allowed.includes(role)) {
    throw new Error('IPC sender is not authorized for this operation')
  }
  if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC is only accepted from the main renderer frame')
  }
  return role
}

export function secureHandle(
  channel: string,
  allowed: readonly RendererRole[],
  listener: InvokeListener
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertIpcSender(event, allowed)
    return listener(event, ...args)
  })
}

export function secureOn(
  channel: string,
  allowed: readonly RendererRole[],
  listener: EventListener
): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertIpcSender(event, allowed)
      listener(event, ...args)
    } catch (error) {
      console.warn(`[ipc] rejected ${channel}: ${(error as Error).message}`)
    }
  })
}
