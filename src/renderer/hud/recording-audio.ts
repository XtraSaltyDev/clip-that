export type RecordingMicrophoneStatus = 'active' | 'disconnected' | 'system-default'

export function createRecordingAudioMixer(
  systemTracks: MediaStreamTrack[],
  microphone: MediaStream | null,
  openDefaultMicrophone: () => Promise<MediaStream>,
  onMicrophoneStatus: (status: RecordingMicrophoneStatus) => void
) {
  // Render the mix without tying its clock to the current playback device.
  const options: AudioContextOptions & { sinkId: { type: 'none' } } = {
    sinkId: { type: 'none' }
  }
  const context = new AudioContext(options)
  const destination = context.createMediaStreamDestination()
  let input: { track: MediaStreamTrack; node: MediaStreamAudioSourceNode } | null = null
  let paused = false
  let disposed = false
  let opening = false
  let retryRequested = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function attachMicrophone(stream: MediaStream): boolean {
    const track = stream.getAudioTracks()[0]
    if (!track || track.readyState !== 'live') return false
    const node = context.createMediaStreamSource(stream)
    track.enabled = !paused
    node.connect(destination)
    input = { track, node }
    track.addEventListener('ended', onMicrophoneEnded, { once: true })
    return true
  }

  function releaseMicrophone(): void {
    if (!input) return
    input.track.removeEventListener('ended', onMicrophoneEnded)
    input.node.disconnect()
    input.track.stop()
    input = null
  }

  async function reconnectMicrophone(): Promise<void> {
    opening = true
    let stream: MediaStream | undefined
    try {
      stream = await openDefaultMicrophone()
      if (!disposed && attachMicrophone(stream)) {
        stream = undefined
        onMicrophoneStatus('system-default')
      }
    } catch {
      // Keep the mic disconnected until another device change lets us try again.
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      opening = false
      if (retryRequested) {
        retryRequested = false
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect(): void {
    if (disposed || input || reconnectTimer) return
    if (opening) {
      retryRequested = true
      return
    }
    // Bluetooth route changes can briefly remove the default input before its replacement is ready.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void reconnectMicrophone()
    }, 250)
  }

  function onMicrophoneEnded(): void {
    releaseMicrophone()
    onMicrophoneStatus('disconnected')
    scheduleReconnect()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearTimeout(reconnectTimer)
    if (microphone) navigator.mediaDevices.removeEventListener('devicechange', scheduleReconnect)
    releaseMicrophone()
    destination.stream.getTracks().forEach((track) => track.stop())
    void context.close()
  }

  try {
    for (const track of systemTracks) {
      context.createMediaStreamSource(new MediaStream([track])).connect(destination)
    }
    if (microphone) {
      navigator.mediaDevices.addEventListener('devicechange', scheduleReconnect)
      if (!attachMicrophone(microphone)) onMicrophoneEnded()
    }
  } catch (error) {
    dispose()
    throw error
  }

  return {
    tracks: destination.stream.getAudioTracks(),
    setPaused(next: boolean) {
      paused = next
      if (input) input.track.enabled = !paused
    },
    dispose
  }
}
