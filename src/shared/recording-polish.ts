import type {
  RecordingMediaCapabilities,
  VideoAspectPreset,
  VideoExportPreset,
  VideoExportOptions
} from './types'

export interface VideoExportPresetDefinition {
  id: Exclude<VideoExportPreset, 'custom'>
  label: string
  detail: string
  format: Extract<VideoExportOptions['format'], 'mp4' | 'webm'>
  quality: 'medium' | 'high'
  fps: number
  maxWidth: number
  aspect: VideoAspectPreset
}

export const VIDEO_EXPORT_PRESETS: readonly VideoExportPresetDefinition[] = [
  {
    id: 'web',
    label: 'Web / share',
    detail: 'WebM VP9/Opus · 1280 px max · 30 fps · original framing',
    format: 'webm',
    quality: 'medium',
    fps: 30,
    maxWidth: 1280,
    aspect: 'original'
  },
  {
    id: 'presentation',
    label: 'Presentation',
    detail: 'MP4 H.264/AAC · 1920 × 1080 canvas · 30 fps',
    format: 'mp4',
    quality: 'high',
    fps: 30,
    maxWidth: 1920,
    aspect: 'landscape'
  },
  {
    id: 'vertical-social',
    label: 'Vertical / social',
    detail: 'MP4 H.264/AAC · 608 × 1080 canvas · 30 fps',
    format: 'mp4',
    quality: 'high',
    fps: 30,
    maxWidth: 1080,
    aspect: 'vertical'
  }
]

export function videoExportPreset(id: VideoExportPreset): VideoExportPresetDefinition | null {
  return VIDEO_EXPORT_PRESETS.find((preset) => preset.id === id) ?? null
}

export function exportPresetAvailability(
  id: VideoExportPreset,
  capabilities: RecordingMediaCapabilities | null
): { available: boolean; reason: string } {
  if (id === 'custom') return { available: true, reason: '' }
  if (!capabilities) return { available: false, reason: 'Checking the bundled media encoders…' }
  const preset = videoExportPreset(id)
  if (!preset) return { available: false, reason: 'This export preset is not recognized.' }
  const supported =
    capabilities.ffmpeg && (preset.format === 'mp4' ? capabilities.mp4 : capabilities.webm)
  return supported
    ? { available: true, reason: '' }
    : {
        available: false,
        reason: capabilities.ffmpeg
          ? `${preset.format.toUpperCase()} export is unavailable in the bundled FFmpeg runtime.`
          : 'The bundled FFmpeg executable is unavailable.'
      }
}

export function aspectRatio(aspect: VideoAspectPreset): number | null {
  if (aspect === 'landscape') return 16 / 9
  if (aspect === 'square') return 1
  if (aspect === 'vertical') return 9 / 16
  return null
}

export function aspectCanvasDimensions(
  aspect: VideoAspectPreset,
  base = 1280
): { width: number; height: number } | null {
  if (aspect === 'original') return null
  if (aspect === 'vertical') return { width: Math.round((base * 9) / 16), height: base }
  if (aspect === 'landscape') return { width: base, height: Math.round((base * 9) / 16) }
  return { width: base, height: base }
}

export function aspectLabel(aspect: VideoAspectPreset): string {
  return {
    original: 'Original',
    landscape: 'Landscape 16:9',
    square: 'Square 1:1',
    vertical: 'Vertical 9:16'
  }[aspect]
}

export type RecordingTranscriptState = 'processing' | 'ready' | 'partial' | 'unavailable' | 'failed'

export interface RecordingTranscriptStatus {
  label: string
  detail: string
  trust: 'trusted' | 'uncertain' | 'unavailable'
  canEdit: boolean
  canShowCaptions: boolean
}

export function transcriptStatus(state: RecordingTranscriptState): RecordingTranscriptStatus {
  switch (state) {
    case 'processing':
      return {
        label: 'Processing transcript',
        detail: 'Keep editing, saving, and exporting the original recording while analysis runs.',
        trust: 'uncertain',
        canEdit: false,
        canShowCaptions: false
      }
    case 'ready':
      return {
        label: 'Transcript ready',
        detail: 'Review the local transcript before using it as captions.',
        trust: 'trusted',
        canEdit: true,
        canShowCaptions: true
      }
    case 'partial':
      return {
        label: 'Partial transcript',
        detail: 'Some speech was recovered, but missing timing or text keeps captions gated.',
        trust: 'uncertain',
        canEdit: true,
        canShowCaptions: false
      }
    case 'failed':
      return {
        label: 'Transcript unavailable',
        detail: 'The original recording is preserved. Retry when a local backend is available.',
        trust: 'unavailable',
        canEdit: false,
        canShowCaptions: false
      }
    default:
      return {
        label: 'Captions unavailable',
        detail:
          'No local speech-to-text backend is configured. The original recording is preserved.',
        trust: 'unavailable',
        canEdit: false,
        canShowCaptions: false
      }
  }
}

export interface RecordingPolishCapabilities {
  zooms: { available: boolean; detail: string }
  cursor: { available: boolean; detail: string }
  clicks: { available: boolean; detail: string }
}

export function recordingPolishCapabilities(input: {
  hasZoomTimeline: boolean
  hasCursorMetadata: boolean
  hasClickMetadata: boolean
}): RecordingPolishCapabilities {
  return {
    zooms: input.hasZoomTimeline
      ? { available: true, detail: 'Zoom keyframes can be edited on the recording timeline.' }
      : {
          available: false,
          detail:
            'This recording has no post-capture zoom timeline. Capture-time auto-zoom is already baked in.'
        },
    cursor: input.hasCursorMetadata
      ? { available: true, detail: 'Cursor emphasis can follow the captured pointer path.' }
      : {
          available: false,
          detail:
            'This recording has no pointer metadata, so ClipThat will not invent a cursor path.'
        },
    clicks: input.hasClickMetadata
      ? { available: true, detail: 'Click emphasis can follow captured click events.' }
      : {
          available: false,
          detail: 'This recording has no click metadata, so click markers are unavailable.'
        }
  }
}

/** Hide the polish panel until a recording actually has editable zoom, cursor, click, or caption data. */
export function recordingPolishVisible(
  polish: RecordingPolishCapabilities,
  transcript: RecordingTranscriptStatus
): boolean {
  return (
    polish.zooms.available ||
    polish.cursor.available ||
    polish.clicks.available ||
    transcript.canEdit ||
    transcript.canShowCaptions
  )
}
