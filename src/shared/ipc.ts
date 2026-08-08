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
  captureWindowInfo: 'capture:window-info',
  captureDisplays: 'capture:displays',
  captureClipboard: 'capture:clipboard',
  captureScrollConfig: 'capture:scroll-config',
  captureScrollFrame: 'capture:scroll-frame',
  captureScrollFallback: 'capture:scroll-fallback',
  captureScrollStitch: 'capture:scroll-stitch',
  captureOverlayInit: 'overlay:init',
  captureScrollFrameCount: 'scroll:frame-count',

  // editor
  editorOpen: 'editor:open',
  editorLoad: 'editor:load',
  editorDocument: 'editor:document',
  editorVideo: 'editor:video',
  editorLoadVideo: 'editor:load-video',
  editorSwitchLibraryItem: 'editor:switch-library-item',
  editorClose: 'editor:close',
  editorCloseRequested: 'editor:close-requested',
  editorCloseReady: 'editor:close-ready',
  editorConfirmClose: 'editor:confirm-close',

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
  libraryHealth: 'library:health',
  libraryIssue: 'library:issue',
  libraryLoadProject: 'library:load-project',
  libraryExportVideo: 'library:export-video',

  // recording
  recordConfigure: 'record:configure',
  recordStart: 'record:start',
  recordStarted: 'record:started',
  recordStop: 'record:stop',
  recordPause: 'record:pause',
  recordResume: 'record:resume',
  recordCancel: 'record:cancel',
  recordStatus: 'record:status',
  recordAppendChunk: 'record:append-chunk',
  recordFinalize: 'record:finalize',
  recordPreserveFailure: 'record:preserve-failure',
  recordRecoveries: 'record:recoveries',
  recordRecover: 'record:recover',
  recordDiscardRecovery: 'record:discard-recovery',
  recordExport: 'record:export',
  recordProgress: 'record:progress',
  recordSources: 'record:sources',
  recordHudCommand: 'record:hud-command',
  recordCursor: 'record:cursor',

  // pins & quick access
  pinCreate: 'pin:create',
  pinInit: 'pin:init',
  quickInit: 'quick:init',
  quickAction: 'quick:action',
  quickDrag: 'quick:drag',

  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  settingsReset: 'settings:reset',
  settingsPickDirectory: 'settings:pick-directory',
  settingsNavigate: 'settings:navigate',

  // system
  permissionsCheck: 'system:permissions',
  permissionsRequest: 'system:permissions-request',
  openExternal: 'system:open-external',
  appInfo: 'system:app-info',
  exportDiagnostics: 'system:export-diagnostics',
  updateCheck: 'system:update-check',
  updateDownload: 'system:update-download',
  windowControl: 'system:window-control',
  toast: 'system:toast',
  quit: 'system:quit',

  // renderer-specialized channels
  hudResize: 'hud:resize',
  hudDock: 'hud:dock',
  hudClose: 'hud:close',
  ocrRequest: 'ocr:request',
  ocrResult: 'ocr:result'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
