import type { SaveImageRequest } from './types'

type ImageFormat = SaveImageRequest['format']

/** A linked still keeps its encoding when the default for new captures changes. */
export function imageFormatForPath(path: string | null | undefined): ImageFormat | undefined {
  const extension = path
    ?.split(/[\\/]/)
    .pop()
    ?.match(/\.([^.]+)$/)?.[1]
    .toLowerCase()
  if (extension === 'jpeg') return 'jpg'
  if (extension === 'png' || extension === 'jpg' || extension === 'webp') return extension
  return undefined
}

export function assertImageFormatMatchesPath(path: string, format: ImageFormat): void {
  const existingFormat = imageFormatForPath(path)
  if (existingFormat && existingFormat !== format) {
    throw new Error(
      `Choose a .${format} filename, or export as ${existingFormat.toUpperCase()} to use this filename.`
    )
  }
}
