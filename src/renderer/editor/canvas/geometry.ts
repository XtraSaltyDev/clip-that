export function pointsCenter(points: number[]): { x: number; y: number } {
  if (points.length < 2) return { x: 0, y: 0 }

  let minX = points[0]
  let maxX = points[0]
  let minY = points[1]
  let maxY = points[1]
  for (let i = 2; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i])
    maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}
