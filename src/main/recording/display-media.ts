import { session } from 'electron'
import { recording } from './session'

/**
 * Grant getDisplayMedia from a source already resolved outside this callback.
 * Calling desktopCapturer.getSources inside the handler deadlocks ScreenCaptureKit.
 */
export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const source = recording.cachedCaptureSource()
      if (!source) {
        callback({})
        return
      }
      callback({ video: source, audio: 'loopback' })
    },
    { useSystemPicker: false }
  )
}
