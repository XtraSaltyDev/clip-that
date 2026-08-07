/** Canonical IPC channel names. Keeping them in one table stops typos across processes. */
export const IPC = {
  // capture
  captureStart: 'capture:start',
  captureRegionResult: 'capture:region-result',
  captureCancel: 'capture:cancel',
  captureOverlayRelease: 'capture:overlay-release',
  captureOverlayUpdate: 'capture:overlay-update',
  captureEditorVisibility: 'capture:editor-visibility',
  captureWindows: 'capture:windows',
  captureWindowPreview: 'capture:window-preview',
  captureDisplays: 'capture:displays',
  captureClipboard: 'capture:clipboard',
  captureScrollConfig: 'capture:scroll-config',
  captureScrollFrame: 'capture:scroll-frame',
  captureScrollFallback: 'capture:scroll-fallback',
  captureScrollStitch: 'capture:scroll-stitch',

  // editor
  editorOpen: 'editor:open',
  editorLoad: 'editor:load',
  editorDocument: 'editor:document',
  editorSwitchLibraryItem: 'editor:switch-library-item',
  editorClose: 'editor:close',

  // export
  saveImage: 'export:save-image',
  copyImage: 'export:copy-image',
  exportPdf: 'export:pdf',
  saveProject: 'export:save-project',
  openProject: 'export:open-project',
  startDrag: 'export:start-drag',
  revealFile: 'export:reveal',
  openFile: 'export:open-file',

  // library
  libraryList: 'library:list',
  libraryAdd: 'library:add',
  libraryUpdate: 'library:update',
  libraryDelete: 'library:delete',
  libraryOpen: 'library:open',
  libraryTags: 'library:tags',
  libraryChanged: 'library:changed',
  libraryLoadProject: 'library:load-project',

  // recording
  recordConfigure: 'record:configure',
  recordStart: 'record:start',
  recordStop: 'record:stop',
  recordPause: 'record:pause',
  recordResume: 'record:resume',
  recordCancel: 'record:cancel',
  recordStatus: 'record:status',
  recordSaveBlob: 'record:save-blob',
  recordExport: 'record:export',
  recordProgress: 'record:progress',
  recordSources: 'record:sources',
  recordHudCommand: 'record:hud-command',

  // pins & quick access
  pinCreate: 'pin:create',
  pinInit: 'pin:init',
  quickInit: 'quick:init',
  quickAction: 'quick:action',

  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  settingsReset: 'settings:reset',
  settingsPickDirectory: 'settings:pick-directory',

  // system
  permissionsCheck: 'system:permissions',
  permissionsRequest: 'system:permissions-request',
  openExternal: 'system:open-external',
  appInfo: 'system:app-info',
  windowControl: 'system:window-control',
  toast: 'system:toast',
  quit: 'system:quit'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
