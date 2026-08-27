import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { settings } from './store/settings'
import { performCapture } from './capture/service'
import { showLibraryWindow, showSettingsWindow } from './windows/manager'
import { emitter } from './hotkeys'
import { recording } from './recording/session'

const IS_MAC = process.platform === 'darwin'

let tray: Tray | null = null

function iconPath(): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'build')
    : join(__dirname, '../../build')
  return join(base, IS_MAC ? 'trayTemplate.png' : 'tray.png')
}

function buildMenu(): Electron.Menu {
  const keys = settings.get().hotkeys
  const isRecording = recording.status().state === 'recording'

  return Menu.buildFromTemplate([
    {
      label: 'Capture Region',
      accelerator: keys.captureRegion,
      click: () => void performCapture({ mode: 'region' })
    },
    {
      label: 'Capture Window',
      accelerator: keys.captureWindow,
      click: () => void performCapture({ mode: 'window' })
    },
    {
      label: 'Capture Screen',
      accelerator: keys.captureFullscreen,
      click: () => void performCapture({ mode: 'display' })
    },
    {
      label: 'Capture All Screens',
      click: () => void performCapture({ mode: 'fullscreen' })
    },
    {
      label: 'Repeat Last Region',
      accelerator: keys.captureLastRegion,
      click: () => void performCapture({ mode: 'lastRegion' })
    },
    {
      label: 'Scrolling Capture',
      accelerator: keys.captureScrolling,
      click: () => void performCapture({ mode: 'scrolling' })
    },
    { type: 'separator' },
    {
      label: 'Capture with Delay',
      submenu: [3, 5, 10].map((delay) => ({
        label: `${delay} seconds`,
        click: () => void performCapture({ mode: 'region', delay })
      }))
    },
    { type: 'separator' },
    isRecording
      ? {
          label: 'Stop Recording',
          accelerator: keys.stopRecording,
          click: () => emitter.emit('stop-recording')
        }
      : {
          label: 'Record Screen…',
          accelerator: keys.startRecording,
          click: () => emitter.emit('start-recording')
        },
    { type: 'separator' },
    { label: 'Grab Text', accelerator: keys.grabText, click: () => emitter.emit('grab-text') },
    { label: 'Library…', accelerator: keys.openLibrary, click: () => showLibraryWindow() },
    { label: 'Settings…', click: () => showSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit ClipThat', role: 'quit' }
  ])
}

export function refreshTray(): void {
  if (!tray) return
  tray.setContextMenu(buildMenu())
  const state = recording.status().state
  tray.setToolTip(state === 'recording' ? 'ClipThat — recording' : 'ClipThat')
}

export function createTray(): void {
  if (tray) return
  if (!settings.get().showInTray) return

  const image = nativeImage.createFromPath(iconPath())
  if (IS_MAC) image.setTemplateImage(true)

  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('ClipThat')
  tray.setContextMenu(buildMenu())

  // A plain click should do the thing people want most.
  tray.on('click', () => {
    if (IS_MAC) return // macOS shows the menu on click already
    void performCapture({ mode: 'region' })
  })

  settings.on('changed', refreshTray)
  recording.on('status', refreshTray)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export function syncTrayVisibility(): void {
  if (settings.get().showInTray) createTray()
  else destroyTray()
}

/** Application menu — mostly for macOS, where an app without one feels broken. */
export function installAppMenu(): void {
  const keys = settings.get().hotkeys

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(IS_MAC
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: () => showSettingsWindow()
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Region Capture',
          accelerator: keys.captureRegion,
          click: () => void performCapture({ mode: 'region' })
        },
        {
          label: 'New Window Capture',
          accelerator: keys.captureWindow,
          click: () => void performCapture({ mode: 'window' })
        },
        {
          label: 'New Screen Capture',
          accelerator: keys.captureFullscreen,
          click: () => void performCapture({ mode: 'display' })
        },
        {
          label: 'Repeat Last Region',
          accelerator: keys.captureLastRegion,
          click: () => void performCapture({ mode: 'lastRegion' })
        },
        { type: 'separator' },
        { label: 'Open Library', accelerator: keys.openLibrary, click: () => showLibraryWindow() },
        { type: 'separator' },
        IS_MAC ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: IS_MAC
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
