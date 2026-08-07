import type { CanvasStyle, RecordingOptions, Settings } from './types'

/**
 * This module is imported by the renderer too, where `process` doesn't exist,
 * so platform detection has to survive its absence.
 */
export const IS_MAC =
  typeof process !== 'undefined'
    ? process.platform === 'darwin'
    : typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

const mod = IS_MAC ? 'Command' : 'Control'

export const DEFAULT_CANVAS: CanvasStyle = {
  padding: 0,
  background: 'none',
  backgroundColor: '#0b0f14',
  gradientFrom: '#6366f1',
  gradientTo: '#ec4899',
  gradientAngle: 135,
  radius: 0,
  shadowBlur: 0,
  shadowOpacity: 0.35,
  shadowOffsetY: 18,
  tiltX: 0,
  tiltY: 0,
  borderWidth: 0,
  borderColor: '#ffffff22',
  frame: 'none',
  frameTitle: ''
}

/** What the "Beautify" button applies in one click. */
export const BEAUTIFY_CANVAS: CanvasStyle = {
  ...DEFAULT_CANVAS,
  padding: 64,
  background: 'gradient',
  radius: 12,
  shadowBlur: 48,
  shadowOpacity: 0.4,
  shadowOffsetY: 22,
  borderWidth: 1
}

export const DEFAULT_RECORDING: RecordingOptions = {
  target: 'display',
  autoZoom: false,
  zoomLevel: 1.6,
  fps: 30,
  microphone: false,
  systemAudio: false,
  webcam: false,
  webcamPosition: 'br',
  webcamSize: 220,
  countdown: 3
}

export function defaultSettings(picturesDir: string): Settings {
  return {
    hotkeys: {
      captureRegion: `${mod}+Shift+2`,
      captureWindow: `${mod}+Shift+3`,
      captureFullscreen: `${mod}+Shift+4`,
      captureLastRegion: `${mod}+Shift+5`,
      captureScrolling: `${mod}+Shift+6`,
      startRecording: `${mod}+Shift+7`,
      stopRecording: `${mod}+Shift+8`,
      openLibrary: `${mod}+Shift+9`,
      grabText: `${mod}+Shift+T`
    },
    // The card, not the editor: most captures just need to be somewhere else fast.
    afterCapture: 'quickAccess',
    pipeline: { copy: true, save: true, pin: false, edit: false, command: '' },
    saveDirectory: picturesDir,
    filenameTemplate: 'ClipThat {yyyy}-{MM}-{dd} at {HH}.{mm}.{ss}',
    imageFormat: 'png',
    jpegQuality: 92,
    copyOnSave: true,
    theme: 'system',
    accent: '#4f8cff',
    launchAtLogin: false,
    showInTray: true,
    showInDock: true,
    autoOcr: true,
    defaultAnnotationColor: '#ff3b30',
    defaultStrokeWidth: 4,
    defaultFontSize: 28,
    defaultFontFamily: 'Inter, system-ui, sans-serif',
    recording: DEFAULT_RECORDING,
    canvasPreset: DEFAULT_CANVAS,
    onboarded: false
  }
}

/** Make a user-facing title safe as one file name on macOS, Windows, and Linux. */
export function safeFilename(value: string, fallback = 'ClipThat'): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180)
  const readable = /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : fallback
  // Windows reserves these device names even when they have an extension.
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(readable)
    ? `ClipThat-${readable}`
    : readable
}

/** Expands `{yyyy}` style tokens in the filename template. */
export function formatFilename(template: string, date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const map: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    yy: pad(date.getFullYear() % 100),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    ms: pad(date.getMilliseconds(), 3)
  }
  const named = template.replace(/\{(\w+)\}/g, (m, key: string) => map[key] ?? m)
  return safeFilename(named)
}
