/**
 * The auto-zoom camera: a smoothed viewport that follows the cursor around the
 * recording, Screen Studio style. Pure math — no DOM, no Electron — so the behaviour
 * that decides what ends up in someone's video is unit-tested.
 *
 * Model: the camera has a centre and a zoom. Each frame the zoom eases toward its
 * target and the centre pans only when the cursor leaves a dead-zone around it — a
 * camera that chases every pixel of cursor motion is nauseating; one that pans when
 * the subject walks out of frame reads as deliberate.
 */

export interface CameraState {
  cx: number
  cy: number
  z: number
}

export interface CameraConfig {
  /** Source frame size in pixels. */
  width: number
  height: number
  /** Target magnification while engaged. */
  zoom: number
  /** Fraction of the visible viewport treated as "already in frame" (0..1). */
  deadZone: number
  /** Per-frame easing toward the pan target (0..1). */
  followAlpha: number
  /** Per-frame easing toward the zoom target (0..1). */
  zoomAlpha: number
}

export const DEFAULT_CAMERA_CONFIG: Omit<CameraConfig, 'width' | 'height' | 'zoom'> = {
  deadZone: 0.4,
  followAlpha: 0.1,
  zoomAlpha: 0.06
}

export function initialCamera(cfg: Pick<CameraConfig, 'width' | 'height'>): CameraState {
  return { cx: cfg.width / 2, cy: cfg.height / 2, z: 1 }
}

/** Keep the viewport fully inside the source frame. */
export function clampCenter(
  cx: number,
  cy: number,
  z: number,
  cfg: Pick<CameraConfig, 'width' | 'height'>
): { cx: number; cy: number } {
  const halfW = cfg.width / (2 * z)
  const halfH = cfg.height / (2 * z)
  return {
    cx: Math.min(cfg.width - halfW, Math.max(halfW, cx)),
    cy: Math.min(cfg.height - halfH, Math.max(halfH, cy))
  }
}

/**
 * Preserve the camera's relative position when the decoded capture changes size.
 * `MediaStreamTrack.getSettings()` is negotiated metadata; the video element's
 * intrinsic size is the authority for pixels that can safely be drawn.
 */
export function resizeCamera(
  cam: CameraState,
  from: Pick<CameraConfig, 'width' | 'height'>,
  to: Pick<CameraConfig, 'width' | 'height'>
): CameraState {
  const cx = from.width > 0 ? (cam.cx / from.width) * to.width : to.width / 2
  const cy = from.height > 0 ? (cam.cy / from.height) * to.height : to.height / 2
  const clamped = clampCenter(cx, cy, cam.z, to)
  return { cx: clamped.cx, cy: clamped.cy, z: cam.z }
}

/**
 * Advance the camera one frame. `cursor` may be null (no data yet) — the camera then
 * just settles its zoom without panning.
 */
export function stepCamera(cam: CameraState, cursor: { x: number; y: number } | null, cfg: CameraConfig): CameraState {
  const z = cam.z + (cfg.zoom - cam.z) * cfg.zoomAlpha

  let { cx, cy } = cam
  if (cursor) {
    // Dead-zone in source pixels at the current zoom.
    const halfDeadW = (cfg.width / z) * cfg.deadZone * 0.5
    const halfDeadH = (cfg.height / z) * cfg.deadZone * 0.5

    // Pan target: the nearest centre that puts the cursor back on the dead-zone edge.
    let tx = cx
    let ty = cy
    if (cursor.x > cx + halfDeadW) tx = cursor.x - halfDeadW
    else if (cursor.x < cx - halfDeadW) tx = cursor.x + halfDeadW
    if (cursor.y > cy + halfDeadH) ty = cursor.y - halfDeadH
    else if (cursor.y < cy - halfDeadH) ty = cursor.y + halfDeadH

    cx += (tx - cx) * cfg.followAlpha
    cy += (ty - cy) * cfg.followAlpha
  }

  const clamped = clampCenter(cx, cy, z, cfg)
  return { cx: clamped.cx, cy: clamped.cy, z }
}

/**
 * The integer source rectangle to draw for the current camera. Integer edges avoid
 * floating-point spill at the bottom/right clamp, where `drawImage()` would otherwise
 * clip the destination and leave pixels from the preceding canvas frame untouched.
 */
export function sourceRect(cam: CameraState, cfg: Pick<CameraConfig, 'width' | 'height'>): {
  sx: number
  sy: number
  sw: number
  sh: number
} {
  const width = Math.max(1, Math.floor(cfg.width))
  const height = Math.max(1, Math.floor(cfg.height))
  const halfW = width / (2 * cam.z)
  const halfH = height / (2 * cam.z)
  const sx = Math.max(0, Math.min(width - 1, Math.floor(cam.cx - halfW)))
  const sy = Math.max(0, Math.min(height - 1, Math.floor(cam.cy - halfH)))
  const right = Math.max(sx + 1, Math.min(width, Math.ceil(cam.cx + halfW)))
  const bottom = Math.max(sy + 1, Math.min(height, Math.ceil(cam.cy + halfH)))
  return {
    sx,
    sy,
    sw: right - sx,
    sh: bottom - sy
  }
}
