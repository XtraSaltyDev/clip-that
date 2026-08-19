import { join } from 'node:path'

export function bundledFfmpegPath(options: {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  const executable = options.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  if (options.packaged) {
    return join(options.resourcesPath, 'third-party', 'ffmpeg', 'bin', executable)
  }
  if (options.platform === 'win32') {
    return join(
      options.appPath,
      'build',
      'vendor',
      'ffmpeg',
      'windows-x64',
      'package',
      'bin',
      executable
    )
  }
  return join(options.appPath, 'build', 'vendor', 'ffmpeg', 'package', 'bin', executable)
}
