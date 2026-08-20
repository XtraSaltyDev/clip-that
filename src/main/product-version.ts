import packageMetadata from '../../package.json'

/**
 * Electron reports its own version for unpackaged entry points. Embed ClipThat's
 * package version so development verification and packaged builds use one source.
 */
export const PRODUCT_VERSION = packageMetadata.version
