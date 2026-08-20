import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, isAbsolute } from 'node:path'
import type { CaptureMode, CaptureResult, GuideDocument } from '@shared/types'
import { IPC } from '@shared/ipc'
import { captureWithoutRouting, documentFromCapture } from '../capture/service'
import { guides } from '../store/guides'
import { broadcast } from '../windows/manager'

let activeGuideId: string | null = null
let capturing = false

export function setActiveGuideSession(guideId: string | null): void {
  activeGuideId = guideId
}

export function activeGuideSession(): string | null {
  return activeGuideId
}

/** Deterministic fixture capture is available only in an explicit isolated acceptance profile. */
export async function captureGuideSource(
  mode: Exclude<CaptureMode, 'scrolling'>
): Promise<CaptureResult | null> {
  const fixture =
    process.env['CLIPTHAT_ACCEPTANCE_PROFILE'] === '1'
      ? process.env['CLIPTHAT_ACCEPTANCE_CAPTURE_FIXTURE']
      : undefined
  if (!fixture) return captureWithoutRouting({ mode })
  if (!isAbsolute(fixture)) throw new Error('Acceptance capture fixture must be absolute')
  const image = nativeImage.createFromPath(fixture)
  if (image.isEmpty()) throw new Error('Acceptance capture fixture could not be decoded')
  const size = image.getSize()
  return {
    id: randomUUID(),
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height,
    scaleFactor: 1,
    source: mode === 'lastRegion' ? 'region' : mode,
    createdAt: Date.now(),
    title: basename(fixture)
  }
}

export async function captureGuideStep(
  guideId: string,
  mode: Exclude<CaptureMode, 'scrolling'> = 'region'
): Promise<GuideDocument | null> {
  if (capturing) throw new Error('A guide capture is already in progress')
  if (!guides.get(guideId)) throw new Error('Guide no longer exists')
  capturing = true
  try {
    const result = await captureGuideSource(mode)
    if (!result) return null
    const next = await guides.addCapture(guideId, result, documentFromCapture(result), {
      kind: 'capture',
      captureMode: result.source
    })
    broadcast(IPC.guideChanged, { guideId })
    return next
  } finally {
    capturing = false
  }
}

export async function captureActiveGuideStep(): Promise<void> {
  const guideId = activeGuideId
  if (!guideId) return
  try {
    const captured = await captureGuideStep(guideId)
    broadcast(IPC.guideHotkeyCapture, {
      guideId,
      ok: Boolean(captured),
      error: captured ? undefined : 'Capture was cancelled'
    })
  } catch (error) {
    broadcast(IPC.guideHotkeyCapture, {
      guideId,
      ok: false,
      error: (error as Error).message
    })
  }
}
