/** The stable native portion of an Electron desktopCapturer window source ID. */
export function nativeWindowSourceId(sourceId: string): string | undefined {
  return /^window:(\d+):/.exec(sourceId)?.[1]
}

/** Electron may change the trailing source suffix between enumerations on macOS. */
export function sameWindowSource(left: string, right: string): boolean {
  if (left === right) return true
  const leftNativeId = nativeWindowSourceId(left)
  return leftNativeId !== undefined && leftNativeId === nativeWindowSourceId(right)
}
