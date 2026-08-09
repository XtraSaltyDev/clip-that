import type { RecordingOptions, Rect } from '@shared/types'
import { api } from '../shared/api'
import {
  DEFAULT_CAMERA_CONFIG,
  initialCamera,
  resizeCamera,
  sourceRect,
  stepCamera,
  type CameraConfig
} from './zoom-camera'

export interface CaptureHandles {
  stream: MediaStream
  /** The OS-owned screen/window track; ending it must stop the recording session too. */
  sourceTrack: MediaStreamTrack
  recorder: MediaRecorder
  mimeType: string
  width: number
  height: number
  setPaused: (paused: boolean) => void
  /** Stop MediaRecorder only after its final chunk has reached durable main-process storage. */
  stop: () => Promise<void>
  dispose: () => void
}

type PersistChunk = (
  sequence: number,
  bytes: Uint8Array,
  mimeType: string
) => Promise<void>

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

/** Give the first decoded frame a chance to establish its intrinsic dimensions. */
async function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 3000): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('resize', ready)
      resolve()
    }
    const ready = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    video.addEventListener('loadeddata', ready)
    video.addEventListener('resize', ready)
  })
}

/**
 * Build the recording pipeline.
 *
 * When the output needs compositing — a webcam bubble, or a cropped region — frames go
 * through a canvas and we record `canvas.captureStream()`. Otherwise the display stream is
 * recorded directly, which is materially cheaper on CPU.
 */
/** The very first desktop stream after launch sometimes hangs while the capture
 * service warms up; a bounded attempt with one retry turns a dead recorder into a
 * one-second hiccup. */
async function getDisplayStream(options: RecordingOptions): Promise<MediaStream> {
  const attempt = async () => {
    // Resolve a fresh source immediately before each attempt. Electron documents the
    // DesktopCapturerSource ID as a chromeMediaSourceId for getUserMedia; this avoids a
    // ScreenCaptureKit deadlock observed when getSources runs inside the
    // setDisplayMediaRequestHandler callback on macOS.
    const sourceId = await api.recording.captureSource()
    return navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: options.fps
        }
      },
      audio: options.systemAudio
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        : false
    } as unknown as MediaStreamConstraints)
  }

  const bounded = (ms: number) =>
    new Promise<MediaStream>((resolve, reject) => {
      let expired = false
      const timer = setTimeout(() => {
        expired = true
        reject(new Error('display capture timed out'))
      }, ms)
      attempt().then(
        (stream) => {
          clearTimeout(timer)
          if (expired) {
            stream.getTracks().forEach((track) => track.stop())
            return
          }
          resolve(stream)
        },
        (err) => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })

  try {
    return await bounded(8000)
  } catch {
    return bounded(12000)
  }
}

export async function startCapture(
  options: RecordingOptions,
  region: Rect | undefined,
  persistChunk: PersistChunk
): Promise<CaptureHandles> {
  const display = await getDisplayStream(options)

  const displayTrack = display.getVideoTracks()[0]
  const settings = displayTrack.getSettings()
  let sourceWidth = settings.width ?? 1920
  let sourceHeight = settings.height ?? 1080

  const mic = options.microphone ? await getMicStream(options.microphoneDeviceId) : null
  const webcam = options.webcam ? await getWebcamStream(options.webcamDeviceId) : null

  const cropped = region && region.width > 0 && region.height > 0
  // Auto-zoom needs per-frame reframing, which only the canvas path can do. It applies
  // to whole displays and windows; a cropped region is already deliberate framing.
  let zoomBounds: Rect | undefined
  if (options.autoZoom && !cropped) {
    if (options.target === 'window' && options.windowId) {
      zoomBounds = (await api.capture.windowInfo(options.windowId))?.bounds
      if (!zoomBounds) {
        display.getTracks().forEach((track) => track.stop())
        mic?.getTracks().forEach((track) => track.stop())
        webcam?.getTracks().forEach((track) => track.stop())
        throw new Error(
          'Auto-zoom could not locate the selected window. Choose Screen or turn Auto-zoom off.'
        )
      }
    } else if (options.target === 'display') {
      const displays = await api.capture.displays()
      zoomBounds = (
        displays.find((d) => d.id === options.displayId) ??
        displays.find((d) => d.primary) ??
        displays[0]
      )?.bounds
    }
  }
  const autoZoom = Boolean(options.autoZoom && !cropped && zoomBounds)
  const needsCanvas = Boolean(webcam) || cropped || autoZoom

  let displayVideo: HTMLVideoElement | null = null
  let webcamVideo: HTMLVideoElement | null = null
  if (needsCanvas) {
    displayVideo = playInline(new MediaStream([displayTrack]))
    if (webcam) webcamVideo = playInline(webcam)
    await waitForVideoFrame(displayVideo)
    sourceWidth = displayVideo.videoWidth || sourceWidth
    sourceHeight = displayVideo.videoHeight || sourceHeight
  }

  let outWidth = cropped ? Math.round(region!.width) : sourceWidth
  let outHeight = cropped ? Math.round(region!.height) : sourceHeight
  // H.264 requires even dimensions; enforce it now so the ffmpeg step never has to scale.
  outWidth -= outWidth % 2
  outHeight -= outHeight % 2

  let videoTrack = displayTrack
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let offCursor: (() => void) | null = null
  let compositingPaused = false

  if (needsCanvas) {
    canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d', { alpha: false })!

    const bubble = Math.min(options.webcamSize, Math.round(Math.min(outWidth, outHeight) * 0.4))
    const margin = Math.round(bubble * 0.12) + 12

    // ---- auto-zoom camera ----
    let camera = initialCamera({ width: sourceWidth, height: sourceHeight })
    let cameraCfg: CameraConfig = {
      width: sourceWidth,
      height: sourceHeight,
      zoom: Math.max(1.1, Math.min(3, options.zoomLevel || 1.6)),
      ...DEFAULT_CAMERA_CONFIG
    }
    let cursorRelative: { x: number; y: number } | null = null
    if (autoZoom && zoomBounds) {
      // Keep the cursor in source-relative coordinates. It is mapped into pixels from
      // each decoded frame, so a mid-stream source resize cannot desynchronise the crop.
      offCursor = api.recording.onCursor((point) => {
        const x = (point.x - zoomBounds!.x) / zoomBounds!.width
        const y = (point.y - zoomBounds!.y) / zoomBounds!.height
        // Cursor outside the captured source: hold the last position rather than yanking.
        if (x >= 0 && y >= 0 && x <= 1 && y <= 1) cursorRelative = { x, y }
      })
    }

    let canvasStream = canvas.captureStream(0)
    let canvasTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    let publishFrame: () => void
    if (typeof canvasTrack.requestFrame === 'function') {
      publishFrame = () => canvasTrack.requestFrame()
    } else {
      // Old engines without manual frame publication keep the previous timed path.
      canvasTrack.stop()
      canvasStream = canvas.captureStream(options.fps)
      canvasTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      publishFrame = () => undefined
    }
    videoTrack = canvasTrack

    const frameInterval = 1000 / Math.max(1, options.fps)
    let nextDrawAt = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      // requestAnimationFrame follows the monitor refresh rate, which may be 60–144 Hz.
      // The output track cannot use frames above the selected recording FPS, so painting
      // those frames only burns CPU/GPU. Keep the camera and canvas on the output cadence.
      if (compositingPaused || now < nextDrawAt) return
      nextDrawAt = nextDrawAt === 0 ? now + frameInterval : nextDrawAt + frameInterval
      if (nextDrawAt < now) nextDrawAt = now + frameInterval
      if (!displayVideo || displayVideo.readyState < 2) return

      if (cropped) {
        ctx.globalCompositeOperation = 'copy'
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
      } else if (autoZoom) {
        const frameWidth = displayVideo.videoWidth || cameraCfg.width
        const frameHeight = displayVideo.videoHeight || cameraCfg.height
        if (frameWidth !== cameraCfg.width || frameHeight !== cameraCfg.height) {
          const nextCfg = { ...cameraCfg, width: frameWidth, height: frameHeight }
          camera = resizeCamera(camera, cameraCfg, nextCfg)
          cameraCfg = nextCfg
        }
        const cursorPx = cursorRelative
          ? { x: cursorRelative.x * cameraCfg.width, y: cursorRelative.y * cameraCfg.height }
          : null
        camera = stepCamera(camera, cursorPx, cameraCfg)
        const { sx, sy, sw, sh } = sourceRect(camera, cameraCfg)
        ctx.globalCompositeOperation = 'copy'
        ctx.drawImage(displayVideo, sx, sy, sw, sh, 0, 0, outWidth, outHeight)
      } else {
        ctx.globalCompositeOperation = 'copy'
        ctx.drawImage(displayVideo, 0, 0, outWidth, outHeight)
      }

      ctx.globalCompositeOperation = 'source-over'

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

      // Manual canvas capture has no clock of its own. Publish only after the complete
      // base frame and optional webcam overlay have reached the canvas.
      publishFrame()
    }
    raf = requestAnimationFrame(draw)
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

  let sequence = 0
  let acceptingChunks = true
  let chunkFailure: Error | null = null
  let chunkWrites: Promise<void> = Promise.resolve()
  recorder.ondataavailable = (e) => {
    if (!acceptingChunks || e.data.size === 0 || chunkFailure) return
    const chunk = e.data
    const chunkSequence = sequence++
    chunkWrites = chunkWrites
      .then(async () => {
        const bytes = new Uint8Array(await chunk.arrayBuffer())
        await persistChunk(chunkSequence, bytes, recorder.mimeType || 'video/webm')
      })
      .catch((err: unknown) => {
        chunkFailure = err instanceof Error ? err : new Error(String(err))
      })
  }

  const setPaused = (paused: boolean) => {
    compositingPaused = paused
    displayTrack.enabled = !paused
    mic?.getTracks().forEach((track) => { track.enabled = !paused })
    webcam?.getTracks().forEach((track) => { track.enabled = !paused })
    if (paused) {
      displayVideo?.pause()
      webcamVideo?.pause()
    } else {
      void displayVideo?.play()
      void webcamVideo?.play()
    }
  }

  let disposed = false
  const disposeMedia = () => {
    if (disposed) return
    disposed = true
    offCursor?.()
    if (raf) cancelAnimationFrame(raf)
    displayVideo?.pause()
    webcamVideo?.pause()
    display.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    webcam?.getTracks().forEach((t) => t.stop())
    videoTrack.stop()
    void audioContext?.close()
  }

  const dispose = () => {
    acceptingChunks = false
    recorder.ondataavailable = null
    if (recorder.state !== 'inactive') recorder.stop()
    disposeMedia()
  }

  // The user can also stop sharing from the OS bar; treat that as "stop".
  displayTrack.addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop()
  })

  let stopped = recorder.state === 'inactive'
  recorder.addEventListener('stop', () => {
    stopped = true
  })

  let stopPromise: Promise<void> | null = null
  const stop = () => {
    if (stopPromise) return stopPromise
    stopPromise = new Promise<void>((resolve) => {
      const finish = () => resolve()
      if (stopped) finish()
      else {
        recorder.addEventListener('stop', finish, { once: true })
        if (recorder.state !== 'inactive') recorder.stop()
      }
    }).then(async () => {
      await chunkWrites
      acceptingChunks = false
      disposeMedia()
      if (chunkFailure) throw chunkFailure
    })
    return stopPromise
  }

  recorder.start(1000)

  return {
    stream,
    sourceTrack: displayTrack,
    recorder,
    mimeType: recorder.mimeType || 'video/webm',
    width: outWidth,
    height: outHeight,
    setPaused,
    stop,
    dispose
  }
}

/** Grab a still from a durable recording URL for the library thumbnail. */
export async function posterFromUrl(url: string, atMs = 200): Promise<string | undefined> {
  try {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
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
