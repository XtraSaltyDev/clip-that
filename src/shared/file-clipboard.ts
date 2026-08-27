/** XML-escape a file path for an Apple plist string node. */
export function escapePlistString(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * NSFilenamesPboardType payload: a binary-compatible XML plist array of absolute
 * paths. Finder paste and other macOS file drops read this pasteboard type.
 */
export function nsFilenamesPlist(paths: string[]): string {
  const items = paths.map((path) => `  <string>${escapePlistString(path)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${items}
</array>
</plist>
`
}
