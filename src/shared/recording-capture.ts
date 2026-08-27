/**
 * How the HUD should open a display stream. Requesting chromeMediaSource audio on
 * the same getUserMedia as the video track hangs ScreenCaptureKit on macOS after
 * the countdown reaches 1, so system audio always uses a separate loopback path.
 */
export function displayCapturePlan(systemAudio: boolean): {
  videoOnlyGetUserMedia: boolean
  loopbackGetDisplayMedia: boolean
} {
  return {
    videoOnlyGetUserMedia: !systemAudio,
    loopbackGetDisplayMedia: systemAudio
  }
}
