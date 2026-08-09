import React, { useEffect, useRef, useState } from 'react'
import { api } from '../shared/api'
import { Icon } from '../shared/icons'
import { useTheme } from '../shared/ui'
import './hud.css'

/**
 * Floating controller for a scrolling capture. It stays out of the way while the user
 * scrolls the window underneath; main keeps grabbing frames until Done is pressed.
 */
export default function ScrollHud(): React.ReactElement {
  useTheme()
  const [frames, setFrames] = useState(0)
  const [busy, setBusy] = useState(false)
  const stopSampler = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    let disposed = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let capture: Promise<void> | null = null

    const stop = async () => {
      disposed = true
      if (timer) clearInterval(timer)
      timer = null
      if (capture) await capture.catch(() => {})
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
    }
    stopSampler.current = stop

    const start = async (restart = 0) => {
      try {
        const config = await api.capture.scrollConfig()
        if (!config || disposed) throw new Error('scroll session is no longer active')

        const sourceId = await api.recording.captureSource()
        const request = navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxFrameRate: 15
            }
          },
          audio: false
        } as unknown as MediaStreamConstraints)
        let expired = false
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            expired = true
            reject(new Error('live display stream timed out'))
          }, 15000)
        })
        request.then((lateStream) => {
          if (expired || disposed) lateStream.getTracks().forEach((track) => track.stop())
        }).catch(() => {})
        try {
          stream = await Promise.race([request, timeout])
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
        }
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const activeStream = stream
        stream.getVideoTracks()[0]?.addEventListener(
          'ended',
          () => {
            if (disposed) return
            if (timer) clearInterval(timer)
            timer = null
            activeStream.getTracks().forEach((track) => track.stop())
            if (stream === activeStream) stream = null

            if (restart < 1) {
              // ScreenCaptureKit occasionally ends a healthy stream during a display
              // transition. Give it one clean reacquisition before using still frames.
              setTimeout(() => {
                if (!disposed) void start(restart + 1)
              }, 750)
            } else {
              api.capture.useScrollFallback('live display stream ended twice')
            }
          },
          { once: true }
        )

        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()

        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(config.rect.width))
        canvas.height = Math.max(1, Math.round(config.rect.height))
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('could not create the scroll frame canvas')

        const sample = () => {
          if (disposed || capture || video.videoWidth < 1 || video.videoHeight < 1) return
          capture = (async () => {
            const scaleX = video.videoWidth / config.displayWidth
            const scaleY = video.videoHeight / config.displayHeight
            context.drawImage(
              video,
              config.rect.x * scaleX,
              config.rect.y * scaleY,
              config.rect.width * scaleX,
              config.rect.height * scaleY,
              0,
              0,
              canvas.width,
              canvas.height
            )
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
            if (!blob || disposed) return
            api.capture.submitScrollFrame(new Uint8Array(await blob.arrayBuffer()))
          })().finally(() => {
            capture = null
          })
        }

        sample()
        timer = setInterval(sample, config.intervalMs)
      } catch (err) {
        if (!disposed) {
          stream?.getTracks().forEach((track) => track.stop())
          stream = null
          api.capture.useScrollFallback((err as Error).message || 'live stream unavailable')
        }
      }
    }

    const offFrames = api.capture.onScrollFrameCount(setFrames)
    void start()
    return () => {
      offFrames()
      void stop()
    }
  }, [])

  const done = async () => {
    setBusy(true)
    await stopSampler.current()
    await api.capture.finishScrolling()
  }

  return (
    <div className="hud-bar drag-region scroll">
      <span className="hud-rec" />
      <div className="no-drag" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>
          {busy ? 'Stitching…' : 'Scroll the content'}
        </div>
        <div className="tiny muted">
          {frames} frame{frames === 1 ? '' : 's'} captured
        </div>
      </div>
      <span className="spacer" />
      <button className="btn sm primary no-drag" disabled={busy || frames === 0} onClick={done}>
        <Icon name="check" size={13} /> Done
      </button>
      <button
        className="hud-btn no-drag"
        title="Cancel"
        onClick={() => {
          void stopSampler.current()
          api.capture.cancel()
          api.hud.close()
        }}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
