import type { Rect, Shape } from './types'

export type ArrangeAction =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical'

/** Arrange visible, unlocked annotations using their actual painted bounds. */
export function arrangeAnnotations(
  shapes: Shape[],
  bounds: Record<string, Rect>,
  action: ArrangeAction
): Record<string, Partial<Shape>> {
  const movable = shapes.filter((shape) => {
    const bound = bounds[shape.id]
    return (
      !shape.locked &&
      !shape.hidden &&
      bound &&
      [bound.x, bound.y, bound.width, bound.height].every(Number.isFinite) &&
      bound.width >= 0 &&
      bound.height >= 0
    )
  })
  const distribute = action === 'horizontal' || action === 'vertical'
  if (movable.length < (distribute ? 3 : 2)) return {}
  const horizontal = ['left', 'center', 'right', 'horizontal'].includes(action)
  const coordinate = horizontal ? 'x' : 'y'
  const dimension = horizontal ? 'width' : 'height'
  const minimum = Math.min(...movable.map((shape) => bounds[shape.id][coordinate]))
  const maximum = Math.max(
    ...movable.map((shape) => bounds[shape.id][coordinate] + bounds[shape.id][dimension])
  )
  const translations: Record<string, number> = {}
  if (distribute) {
    const ordered = [...movable].sort((a, b) => bounds[a.id][coordinate] - bounds[b.id][coordinate])
    const first = bounds[ordered[0].id]
    const last = bounds[ordered.at(-1)!.id]
    const extent = last[coordinate] + last[dimension] - first[coordinate]
    const occupied = ordered.reduce((sum, shape) => sum + bounds[shape.id][dimension], 0)
    const gap = (extent - occupied) / (ordered.length - 1)
    let position = first[coordinate] + first[dimension] + gap
    for (let index = 1; index < ordered.length - 1; index++) {
      const shape = ordered[index]
      const bound = bounds[shape.id]
      translations[shape.id] = position - bound[coordinate]
      position += bound[dimension] + gap
    }
  } else {
    for (const shape of movable) {
      const bound = bounds[shape.id]
      const target =
        action === 'left' || action === 'top'
          ? minimum
          : action === 'right' || action === 'bottom'
            ? maximum - bound[dimension]
            : (minimum + maximum - bound[dimension]) / 2
      translations[shape.id] = target - bound[coordinate]
    }
  }
  const patch: Record<string, Partial<Shape>> = {}
  for (const shape of movable) {
    const delta = translations[shape.id]
    if (delta === undefined || Math.abs(delta) < 0.001) continue
    patch[shape.id] =
      'points' in shape
        ? ({
            points: shape.points.map(
              (value, index) => value + ((index % 2 === 0) === horizontal ? delta : 0)
            )
          } as Partial<Shape>)
        : ({ [coordinate]: shape[coordinate] + delta } as Partial<Shape>)
  }
  return patch
}
