import { compareSemanticVersions } from './contract'

const MAX_UPDATE_BYTES = 3_000_000_000
const SHA512 = /^[A-Za-z0-9+/]{86}==$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

interface UpdateFileMetadata {
  url: string
  sha512: string
  size?: number
}

export interface MacUpdateMetadata {
  version: string
  files: UpdateFileMetadata[]
  releaseDate?: string
}

export class InvalidUpdateMetadataError extends Error {}

export function validateMacUpdateMetadata(info: MacUpdateMetadata): {
  version: string
  publishedAt: string
  size: number
} {
  try {
    compareSemanticVersions(info.version, info.version)
  } catch {
    throw new InvalidUpdateMetadataError('update metadata has an invalid version')
  }

  const expectedZip = `releases/${info.version}/ClipThat-${info.version}-arm64-mac.zip`
  if (info.files.length !== 1 || info.files[0]?.url !== expectedZip) {
    throw new InvalidUpdateMetadataError(
      'update metadata does not contain exactly the expected ZIP'
    )
  }
  const zip = info.files[0]
  if (!Number.isSafeInteger(zip.size) || (zip.size ?? 0) <= 0 || zip.size! > MAX_UPDATE_BYTES) {
    throw new InvalidUpdateMetadataError('update metadata has an invalid ZIP size')
  }
  if (!SHA512.test(zip.sha512)) {
    throw new InvalidUpdateMetadataError('update metadata has an invalid ZIP digest')
  }
  if (
    !info.releaseDate ||
    !ISO_TIMESTAMP.test(info.releaseDate) ||
    Number.isNaN(Date.parse(info.releaseDate)) ||
    new Date(info.releaseDate).toISOString() !== info.releaseDate
  ) {
    throw new InvalidUpdateMetadataError('update metadata has an invalid release date')
  }
  if (zip.url.includes('..') || zip.url.includes('\\')) {
    throw new InvalidUpdateMetadataError('update metadata contains an unsafe artifact path')
  }
  return { version: info.version, publishedAt: info.releaseDate, size: zip.size! }
}
