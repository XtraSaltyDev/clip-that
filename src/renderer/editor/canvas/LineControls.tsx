import React from 'react'
import Konva from 'konva'
import { Circle, Group } from 'react-konva'
import type { ArrowShape } from '@shared/types'
import {
  directHandleMetrics,
  effectiveLinePoints,
  lineCurvePoint,
  lineEndpoint,
  type LineEndpoint,
  type Point
} from './geometry'

export type DirectLineGesture = 'start' | 'end' | 'curve' | 'body'

interface Props {
  shape: ArrowShape
  zoom: number
  /** Image-space offset shared by the artwork and this overlay. */
  x: number
  y: number
  onBegin: (gesture: DirectLineGesture) => void
  onEndpointMove: (endpoint: LineEndpoint, point: Point, shift: boolean) => Point
  onCurveMove: (point: Point) => Point
  onEnd: () => void
}

function stop(e: Konva.KonvaEventObject<MouseEvent | DragEvent>): void {
  e.cancelBubble = true
}

function handleRadius(zoom: number): number {
  return directHandleMetrics(zoom).radius
}

function hitStrokeWidth(zoom: number): number {
  return directHandleMetrics(zoom).hitStrokeWidth
}

function EndpointHandle({
  endpoint,
  point,
  zoom,
  onBegin,
  onMove,
  onEnd
}: {
  endpoint: LineEndpoint
  point: Point
  zoom: number
  onBegin: () => void
  onMove: (point: Point, shift: boolean) => Point
  onEnd: () => void
}): React.ReactElement {
  return (
    <Circle
      name={`line-${endpoint}-handle`}
      x={point.x}
      y={point.y}
      radius={handleRadius(zoom)}
      hitStrokeWidth={hitStrokeWidth(zoom)}
      fill="#ffffff"
      stroke="#4f8cff"
      strokeWidth={1.5 / Math.max(zoom, 0.05)}
      draggable
      onMouseDown={stop}
      onDragStart={(e) => {
        stop(e)
        onBegin()
      }}
      onDragMove={(e) => {
        stop(e)
        e.target.position(onMove({ x: e.target.x(), y: e.target.y() }, e.evt.shiftKey))
      }}
      onDragEnd={(e) => {
        stop(e)
        onEnd()
      }}
    />
  )
}

/**
 * Snagit-style controls for one two-point line-like annotation. This lives above the artwork,
 * outside the clipped shape group, and is intentionally absent from the export path because the
 * Stage clears selection before flattening.
 */
export function LineControls({
  shape,
  zoom,
  x,
  y,
  onBegin,
  onEndpointMove,
  onCurveMove,
  onEnd
}: Props): React.ReactElement {
  const points = effectiveLinePoints(shape)
  const start = lineEndpoint(points, 'start')
  const end = lineEndpoint(points, 'end')
  const curvePoint = shape.curve === undefined ? null : lineCurvePoint(points, shape.curve)

  return (
    <Group x={x} y={y} name="line-controls">
      <EndpointHandle
        endpoint="start"
        point={start}
        zoom={zoom}
        onBegin={() => onBegin('start')}
        onMove={(point, shift) => onEndpointMove('start', point, shift)}
        onEnd={onEnd}
      />
      <EndpointHandle
        endpoint="end"
        point={end}
        zoom={zoom}
        onBegin={() => onBegin('end')}
        onMove={(point, shift) => onEndpointMove('end', point, shift)}
        onEnd={onEnd}
      />
      {curvePoint && (
        <Circle
          name="line-curve-handle"
          x={curvePoint.x}
          y={curvePoint.y}
          radius={handleRadius(zoom)}
          hitStrokeWidth={hitStrokeWidth(zoom)}
          fill="#4f8cff"
          stroke="#ffffff"
          strokeWidth={1.5 / Math.max(zoom, 0.05)}
          draggable
          onMouseDown={stop}
          onDragStart={(e) => {
            stop(e)
            onBegin('curve')
          }}
          onDragMove={(e) => {
            stop(e)
            e.target.position(onCurveMove({ x: e.target.x(), y: e.target.y() }))
          }}
          onDragEnd={(e) => {
            stop(e)
            onEnd()
          }}
        />
      )}
    </Group>
  )
}
