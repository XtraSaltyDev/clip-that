import type { RecordingOptions, Rect } from '@shared/types'

export interface CaptureHandles {
  stream: MediaStream
  recorder: MediaRecorder
  chunks: Blob[]
  width: number
  height: number
  stop: () => Promise<Blob>
  dispose: () => void
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm'
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
}

/** Bitrate that keeps text legible without producing gigabyte files. */
function videoBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height
  const perPixel = 0.09 // bits per pixel per frame — tuned for screen content
  return Math.round(Math.min(24_000_000, Math.max(2_000_000, pixels * fps * perPixel)))
}

async function getMicStream(deviceId?: string): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  } catch {
    return null
  }
}

async function getWebcamStream(deviceId?: string): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    })
  } catch {
    return null
  }
}

function playInline(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  void video.play()
  return video
}

/**
 * Build the recording pipeline.
 *
 * When the output needs compositing — a webcam bubble, or a cropped region — frames go
 * through a canvas and we record `canvas.captureStream()`. Otherwise the display stream is
 * recorded directly, which is materially cheaper on CPU.
 */
export async function startCapture(options: RecordingOptions, region?: Rect): Promise<CaptureHandles> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: options.fps, max: options.fps } },
    audio: options.systemAudio
  } as MediaStreamConstraints)

  const displayTrack = display.getVideoTracks()[0]
  const settings = displayTrack.getSettings()
  const sourceWidth = settings.width ?? 1920
  const sourceHeight = settings.height ?? 1080

  const mic = options.microphone ? await getMicStream(options.microphoneDeviceId) : null
  const webcam = options.webcam ? await getWebcamStream(options.webcamDeviceId) : null

  const cropped = region && region.width > 0 && region.height > 0
  const needsCanvas = Boolean(webcam) || cropped

  let outWidth = cropped ? Math.round(region!.width) : sourceWidth
  let outHeight = cropped ? Math.round(region!.height) : sourceHeight
  // H.264 requires even dimensions; enforce it now so the ffmpeg step never has to scale.
  outWidth -= outWidth % 2
  outHeight -= outHeight % 2

  let videoTrack = displayTrack
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let displayVideo: HTMLVideoElement | null = null
  let webcamVideo: HTMLVideoElement | null = null

  if (needsCanvas) {
    displayVideo = playInline(new MediaStream([displayTrack]))
    if (webcam) webcamVideo = playInline(webcam)

    canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d', { alpha: false })!

    const bubble = Math.min(options.webcamSize, Math.round(Math.min(outWidth, outHeight) * 0.4))
    const margin = Math.round(bubble * 0.12) + 12

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!displayVideo || displayVideo.readyState < 2) return

      if (cropped) {
        ctx.drawImage(
          displayVideo,
          region!.x,
          region!.y,
          region!.width,
          region!.height,
          0,
          0,
          outWidth,
          outHeight
        )
      } else {
        ctx.drawImage(displayVideo, 0, 0, outWidth, outHeight)
      }

      if (webcamVideo && webcamVideo.readyState >= 2) {
        const vw = webcamVideo.videoWidth
        const vh = webcamVideo.videoHeight
        const side = Math.min(vw, vh)
        const sx = (vw - side) / 2
        const sy = (vh - side) / 2

        const x =
          options.webcamPosition === 'tl' || options.webcamPosition === 'bl'
            ? margin
            : outWidth - bubble - margin
        const y =
          options.webcamPosition === 'tl' || options.webcamPosition === 'tr'
            ? margin
            : outHeight - bubble - margin

        ctx.save()
        ctx.beginPath()
        ctx.arc(x + bubble / 2, y + bubble / 2, bubble / 2, 0, Math.PI * 2)
        ctx.closePath()
        ctx.shadowColor = 'rgba(0,0,0,0.45)'
        ctx.shadowBlur = bubble * 0.12
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.clip()
        ctx.drawImage(webcamVideo, sx, sy, side, side, x, y, bubble, bubble)
        ctx.restore()

        ctx.beginPath()
        ctx.arc(x + bubble / 2, y + bubble / 2, bubble / 2, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = Math.max(2, bubble * 0.018)
        ctx.stroke()
      }
    }
    draw()

    videoTrack = canvas.captureStream(options.fps).getVideoTracks()[0]
  }

  /* ---------- audio ---------- */

  const audioSources = [
    ...(options.systemAudio ? display.getAudioTracks() : []),
    ...(mic ? mic.getAudioTracks() : [])
  ]

  let audioContext: AudioContext | null = null
  let audioTracks: MediaStreamTrack[] = []

  if (audioSources.length === 1) {
    audioTracks = audioSources
  } else if (audioSources.length > 1) {
    // Two sources have to be summed into one track or MediaRecorder drops all but the first.
    audioContext = new AudioContext()
    const destination = audioContext.createMediaStreamDestination()
    for (const track of audioSources) {
      const source = audioContext.createMediaStreamSource(new MediaStream([track]))
      source.connect(destination)
    }
    audioTracks = destination.stream.getAudioTracks()
  }

  const stream = new MediaStream([videoTrack, ...audioTracks])

  const recorder = new MediaRecorder(stream, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: videoBitrate(outWidth, outHeight, options.fps),
    audioBitsPerSecond: 128_000
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const dispose = () => {
    if (raf) cancelAnimationFrame(raf)
    displayVideo?.pause()
    webcamVideo?.pause()
    display.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    webcam?.getTracks().forEach((t) => t.stop())
    videoTrack.stop()
    void audioContext?.close()
  }

  // The user can also stop sharing from the OS bar; treat that as "stop".
  displayTrack.addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop()
  })

  const stop = () =>
    new Promise<Blob>((resolve) => {
      const finish = () => {
        dispose()
        resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
      }
      if (recorder.state === 'inactive') finish()
      else {
        recorder.onstop = finish
        recorder.stop()
      }
    })

  recorder.start(1000)

  return { stream, recorder, chunks, width: outWidth, height: outHeight, stop, dispose }
}

/** Grab a still from a recorded blob for the library thumbnail. */
export async function posterFromBlob(blob: Blob, atMs = 200): Promise<string | undefined> {
  const url = URL.createObjectURL(blob)
  try {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = reject
      setTimeout(reject, 8000)
    })
    video.currentTime = Math.min(atMs / 1000, Math.max(0, (video.duration || 1) - 0.1))
    await new Promise((resolve) => {
      video.onseeked = resolve
      setTimeout(resolve, 2000)
    })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 360
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function listDevices(): Promise<{
  microphones: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
}> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      microphones: devices.filter((d) => d.kind === 'audioinput'),
      cameras: devices.filter((d) => d.kind === 'videoinput')
    }
  } catch {
    return { microphones: [], cameras: [] }
  }
}
