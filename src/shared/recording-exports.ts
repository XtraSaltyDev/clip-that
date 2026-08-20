export type RecordingExportAvailability = {
  mp4: boolean
  webm: boolean
  gif: boolean
}

export const hasUsableRecordingExport = (media: RecordingExportAvailability): boolean =>
  media.mp4 || media.webm || media.gif
