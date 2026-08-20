import { join } from 'node:path'

export function bundledMediaToolPath(
  options: {
    platform: NodeJS.Platform
    packaged: boolean
    resourcesPath: string
    appPath: string
  },
  tool: 'ffmpeg' | 'ffprobe'
): string {
  const executable = options.platform === 'win32' ? `${tool}.exe` : tool
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

export function bundledFfmpegPath(options: Parameters<typeof bundledMediaToolPath>[0]): string {
  return bundledMediaToolPath(options, 'ffmpeg')
}

export function bundledFfprobePath(options: Parameters<typeof bundledMediaToolPath>[0]): string {
  return bundledMediaToolPath(options, 'ffprobe')
}
