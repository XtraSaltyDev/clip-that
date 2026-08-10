import React, { useEffect, useRef } from 'react'
import Konva from 'konva'
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
  RegularPolygon,
  Text as KonvaText
} from 'react-konva'
import type {
  ArrowShape,
  BoxShape,
  FreehandShape,
  Shape,
  StepShape,
  TextShape
} from '@shared/types'
import { pointsCenter } from './geometry'

export interface ShapeContext {
  image: HTMLImageElement
  /** Crop origin in image pixels — spotlight needs it to know what "outside" means. */
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  /** Current stage scale, so hit areas stay usable when zoomed out. */
  zoom: number
}

interface Props {
  shape: Shape
  ctx: ShapeContext
  draggable: boolean
  onSelect: (id: string, additive: boolean) => void
  onChange: (id: string, patch: Partial<Shape>) => void
  onDragStart: () => void
  onEditText: (id: string) => void
  hidden?: boolean
}

/** Common Konva props every shape shares. */
function common(shape: Shape, props: Props) {
  return {
    id: shape.id,
    name: 'shape',
    opacity: shape.hidden ? 0 : (shape.opacity ?? 1),
    rotation: shape.rotation ?? 0,
    listening: !shape.locked && !shape.hidden,
    draggable: props.draggable && !shape.locked,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true
      props.onSelect(shape.id, e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)
    },
    onDragStart: props.onDragStart
  }
}

function shadowProps(shape: {
  shadow?: boolean
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
}) {
  if (!shape.shadow) return {}
  return {
    shadowColor: shape.shadowColor ?? '#000000',
    shadowBlur: shape.shadowBlur ?? 6,
    shadowOffsetX: shape.shadowOffsetX ?? 0,
    shadowOffsetY: shape.shadowOffsetY ?? 2,
    shadowOpacity: 0.55
  }
}

/* ------------------------------------------------------------------ *
 * Filtered regions (blur / pixelate)
 * ------------------------------------------------------------------ */

/**
 * Draws a slice of the base image with a Konva filter applied.
 *
 * The node has to be cached for filters to run, and the cache has to be rebuilt whenever the
 * geometry or intensity changes — that's the whole reason this lives in its own component.
 */
function FilteredRegion(props: Props & { filter: 'blur' | 'pixelate' }): React.ReactElement | null {
  const shape = props.shape as BoxShape
  const ref = useRef<Konva.Image>(null)
  const { image } = props.ctx
  const w = Math.max(1, Math.abs(shape.width))
  const h = Math.max(1, Math.abs(shape.height))
  const x = shape.width < 0 ? shape.x + shape.width : shape.x
  const y = shape.height < 0 ? shape.y + shape.height : shape.y
  const intensity = shape.intensity ?? 12

  useEffect(() => {
    const node = ref.current
    if (!node || !image.complete) return
    // Caching is what makes the filter run at all, and it re-runs on every drag frame.
    // Above ~1 megapixel that becomes the bottleneck, so sample the cache down; a blur
    // of a blur-resolution buffer is visually identical.
    const area = w * h
    const pixelRatio = area > 1_400_000 ? Math.max(0.35, Math.sqrt(1_400_000 / area)) : 1
    node.cache({ pixelRatio })
    node.getLayer()?.batchDraw()
  }, [image, x, y, w, h, intensity, props.filter])

  if (w < 1 || h < 1) return null

  return (
    <KonvaImage
      {...common(shape, props)}
      ref={ref}
      image={image}
      x={x}
      y={y}
      width={w}
      height={h}
      crop={{ x, y, width: w, height: h }}
      cornerRadius={shape.cornerRadius ?? 0}
      filters={[props.filter === 'blur' ? Konva.Filters.Blur : Konva.Filters.Pixelate]}
      blurRadius={props.filter === 'blur' ? intensity : undefined}
      pixelSize={props.filter === 'pixelate' ? Math.max(2, Math.round(intensity)) : undefined}
      onDragEnd={(e) =>
        props.onChange(shape.id, { x: e.target.x(), y: e.target.y() } as Partial<Shape>)
      }
    />
  )
}

/* ------------------------------------------------------------------ *
 * Magnifier
 * ------------------------------------------------------------------ */

function Magnifier(props: Props): React.ReactElement | null {
  const shape = props.shape as BoxShape
  const w = Math.max(1, Math.abs(shape.width))
  const h = Math.max(1, Math.abs(shape.height))
  const x = shape.width < 0 ? shape.x + shape.width : shape.x
  const y = shape.height < 0 ? shape.y + shape.height : shape.y
  const zoom = Math.max(1.2, shape.intensity ?? 2)

  // Sample a smaller area from the same spot and blow it up to fill the box.
  const srcW = w / zoom
  const srcH = h / zoom
  const srcX = x + (w - srcW) / 2
  const srcY = y + (h - srcH) / 2

  return (
    <Group
      {...common(shape, props)}
      x={x}
      y={y}
      onDragEnd={(e) =>
        props.onChange(shape.id, { x: e.target.x(), y: e.target.y() } as Partial<Shape>)
      }
    >
      <KonvaImage
        image={props.ctx.image}
        width={w}
        height={h}
        crop={{ x: srcX, y: srcY, width: srcW, height: srcH }}
        cornerRadius={shape.cornerRadius ?? 6}
        shadowColor="#000"
        shadowBlur={14}
        shadowOpacity={0.4}
      />
      <Rect
        width={w}
        height={h}
        cornerRadius={shape.cornerRadius ?? 6}
        stroke={shape.stroke || '#ffffff'}
        strokeWidth={shape.strokeWidth || 3}
      />
    </Group>
  )
}

/* ------------------------------------------------------------------ *
 * Spotlight
 * ------------------------------------------------------------------ */

function Spotlight(props: Props): React.ReactElement {
  const shape = props.shape as BoxShape
  const { cropX, cropY, cropW, cropH } = props.ctx
  const w = Math.max(0, Math.abs(shape.width))
  const h = Math.max(0, Math.abs(shape.height))
  const x = shape.width < 0 ? shape.x + shape.width : shape.x
  const y = shape.height < 0 ? shape.y + shape.height : shape.y
  const dim = shape.dim ?? 0.62

  // Four bands around the hole beats a composite operation: it stays crisp at any zoom
  // and never needs the group to be cached.
  const bands = [
    { x: cropX, y: cropY, width: cropW, height: Math.max(0, y - cropY) },
    { x: cropX, y: y + h, width: cropW, height: Math.max(0, cropY + cropH - (y + h)) },
    { x: cropX, y, width: Math.max(0, x - cropX), height: h },
    { x: x + w, y, width: Math.max(0, cropX + cropW - (x + w)), height: h }
  ]

  return (
    <Group {...common(shape, props)} draggable={false} onDragEnd={undefined}>
      {bands.map((b, i) => (
        <Rect key={i} {...b} fill="#000000" opacity={dim} listening={false} />
      ))}
      <Rect
        x={x}
        y={y}
        width={w}
        height={h}
        cornerRadius={shape.cornerRadius ?? 0}
        stroke={shape.stroke && shape.stroke !== 'transparent' ? shape.stroke : undefined}
        strokeWidth={shape.strokeWidth}
        draggable={props.draggable && !shape.locked}
        onDragEnd={(e) => {
          props.onChange(shape.id, { x: e.target.x(), y: e.target.y() } as Partial<Shape>)
        }}
        onMouseDown={(e) => {
          e.cancelBubble = true
          props.onSelect(shape.id, e.evt.shiftKey)
        }}
        onDragStart={props.onDragStart}
      />
    </Group>
  )
}

/* ------------------------------------------------------------------ *
 * Callout
 * ------------------------------------------------------------------ */

function Callout(props: Props): React.ReactElement {
  const shape = props.shape as TextShape
  const w = shape.width
  const h = shape.height ?? 80
  const tail = shape.tail ?? { x: w / 2, y: h + 40 }

  // Anchor the tail to whichever edge faces the target point.
  const cx = w / 2
  const cy = h / 2
  const dx = tail.x - cx
  const dy = tail.y - cy
  const horizontal = Math.abs(dx) / (w || 1) > Math.abs(dy) / (h || 1)
  const spread = Math.min(22, (horizontal ? h : w) * 0.3)

  const anchor: number[] = horizontal
    ? dx > 0
      ? [w, cy - spread, w, cy + spread]
      : [0, cy - spread, 0, cy + spread]
    : dy > 0
      ? [cx - spread, h, cx + spread, h]
      : [cx - spread, 0, cx + spread, 0]

  return (
    <Group
      {...common(shape, props)}
      x={shape.x}
      y={shape.y}
      onDblClick={() => props.onEditText(shape.id)}
      onDragEnd={(e) =>
        props.onChange(shape.id, { x: e.target.x(), y: e.target.y() } as Partial<Shape>)
      }
    >
      <Line
        points={[anchor[0], anchor[1], tail.x, tail.y, anchor[2], anchor[3]]}
        closed
        fill={shape.background ?? '#ff3b30'}
        {...shadowProps(shape)}
      />
      <Rect
        width={w}
        height={h}
        cornerRadius={shape.cornerRadius ?? 10}
        fill={shape.background ?? '#ff3b30'}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        {...shadowProps(shape)}
      />
      <KonvaText
        x={shape.padding ?? 12}
        y={shape.padding ?? 12}
        width={Math.max(10, w - (shape.padding ?? 12) * 2)}
        height={Math.max(10, h - (shape.padding ?? 12) * 2)}
        text={shape.text || 'Double-click to edit'}
        fontFamily={shape.fontFamily}
        fontSize={shape.fontSize}
        fontStyle={shape.fontStyle}
        fill={shape.color}
        align={shape.align ?? 'left'}
        verticalAlign="middle"
        listening={false}
        opacity={shape.text ? 1 : 0.6}
      />
      {/* Tail grip */}
      {props.draggable && (
        <Circle
          x={tail.x}
          y={tail.y}
          radius={6}
          fill="#ffffff"
          stroke="#00000055"
          strokeWidth={1}
          draggable
          onDragStart={props.onDragStart}
          onDragMove={(e) => {
            props.onChange(shape.id, {
              tail: { x: e.target.x(), y: e.target.y() }
            } as Partial<Shape>)
          }}
          onMouseDown={(e) => {
            e.cancelBubble = true
          }}
        />
      )}
    </Group>
  )
}

/* ------------------------------------------------------------------ *
 * Dispatcher
 * ------------------------------------------------------------------ */

function ShapeNodeInner(props: Props): React.ReactElement | null {
  const { shape } = props

  const boxDrag = (id: string) => (e: Konva.KonvaEventObject<DragEvent>) =>
    props.onChange(id, { x: e.target.x(), y: e.target.y() } as Partial<Shape>)

  switch (shape.type) {
    case 'arrow':
    case 'line':
    case 'measure': {
      const s = shape as ArrowShape
      const [x1, y1, x2, y2] = s.points
      const curve = s.curve ?? 0
      const origin =
        s.type === 'measure' ? { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } : pointsCenter(s.points)
      let points = [x1 - origin.x, y1 - origin.y, x2 - origin.x, y2 - origin.y]
      if (curve !== 0) {
        // Bow the line by pushing a midpoint along the perpendicular.
        const mx = (x1 + x2) / 2 - origin.x
        const my = (y1 + y2) / 2 - origin.y
        const len = Math.hypot(x2 - x1, y2 - y1) || 1
        const nx = -(y2 - y1) / len
        const ny = (x2 - x1) / len
        points = [
          x1 - origin.x,
          y1 - origin.y,
          mx + nx * curve,
          my + ny * curve,
          x2 - origin.x,
          y2 - origin.y
        ]
      }
      const head = s.strokeWidth * (s.headScale ?? 3)
      const arrowProps = {
        x: origin.x,
        y: origin.y,
        points,
        tension: curve !== 0 ? 0.4 : 0,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        dash: s.dash,
        fill: s.stroke,
        lineCap: 'round' as const,
        lineJoin: 'round' as const,
        pointerLength: s.endHead || s.startHead ? head : 0,
        pointerWidth: s.endHead || s.startHead ? head * 0.8 : 0,
        pointerAtBeginning: Boolean(s.startHead),
        pointerAtEnding: s.endHead !== false && s.type !== 'line',
        hitStrokeWidth: Math.max(18, s.strokeWidth * 3),
        ...shadowProps(s)
      }
      const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
        const dx = e.target.x() - origin.x
        const dy = e.target.y() - origin.y
        e.target.position(origin)
        props.onChange(shape.id, {
          points: s.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy))
        } as Partial<Shape>)
      }

      if (s.type !== 'measure') {
        return <Arrow {...common(shape, props)} {...arrowProps} onDragEnd={onDragEnd} />
      }
      const length = Math.round(Math.hypot(x2 - x1, y2 - y1))
      const centerX = (x1 + x2) / 2
      const centerY = (y1 + y2) / 2
      return (
        <Group
          {...common(shape, props)}
          key={`${shape.id}-m`}
          x={centerX}
          y={centerY}
          onDragEnd={onDragEnd}
        >
          <Arrow {...arrowProps} listening={false} />
          <KonvaText
            x={-40}
            y={-s.strokeWidth * 4}
            width={80}
            align="center"
            text={`${length} px`}
            fontFamily="ui-monospace, monospace"
            fontSize={Math.max(12, s.strokeWidth * 3.5)}
            fill={s.stroke}
            listening={false}
          />
        </Group>
      )
    }

    case 'pen':
    case 'highlighter': {
      const s = shape as FreehandShape
      const origin = pointsCenter(s.points)
      return (
        <Line
          {...common(shape, props)}
          x={origin.x}
          y={origin.y}
          points={s.points.map((value, index) => value - (index % 2 === 0 ? origin.x : origin.y))}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          tension={0.4}
          lineCap="round"
          lineJoin="round"
          globalCompositeOperation={s.type === 'highlighter' ? 'multiply' : undefined}
          hitStrokeWidth={Math.max(18, s.strokeWidth)}
          onDragEnd={(e) => {
            const dx = e.target.x() - origin.x
            const dy = e.target.y() - origin.y
            e.target.position(origin)
            props.onChange(shape.id, {
              points: s.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy))
            } as Partial<Shape>)
          }}
        />
      )
    }

    case 'rect': {
      const s = shape as BoxShape
      const w = Math.abs(s.width)
      const h = Math.abs(s.height)
      return (
        <Rect
          {...common(shape, props)}
          x={s.width < 0 ? s.x + s.width : s.x}
          y={s.height < 0 ? s.y + s.height : s.y}
          width={w}
          height={h}
          cornerRadius={s.cornerRadius ?? 0}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          dash={s.dash}
          fill={s.fill}
          opacity={(shape.opacity ?? 1) * 1}
          fillEnabled={Boolean(s.fill)}
          {...shadowProps(s)}
          onDragEnd={boxDrag(shape.id)}
        />
      )
    }

    case 'ellipse': {
      const s = shape as BoxShape
      const w = Math.abs(s.width)
      const h = Math.abs(s.height)
      const x = (s.width < 0 ? s.x + s.width : s.x) + w / 2
      const y = (s.height < 0 ? s.y + s.height : s.y) + h / 2
      return (
        <Ellipse
          {...common(shape, props)}
          x={x}
          y={y}
          radiusX={w / 2}
          radiusY={h / 2}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          dash={s.dash}
          fill={s.fill}
          fillEnabled={Boolean(s.fill)}
          {...shadowProps(s)}
          onDragEnd={(e) => {
            props.onChange(shape.id, {
              x: e.target.x() - w / 2,
              y: e.target.y() - h / 2
            } as Partial<Shape>)
          }}
        />
      )
    }

    case 'redact': {
      const s = shape as BoxShape
      const w = Math.abs(s.width)
      const h = Math.abs(s.height)
      return (
        <Rect
          {...common(shape, props)}
          x={s.width < 0 ? s.x + s.width : s.x}
          y={s.height < 0 ? s.y + s.height : s.y}
          width={w}
          height={h}
          cornerRadius={s.cornerRadius ?? 2}
          fill={s.fill ?? '#000000'}
          onDragEnd={boxDrag(shape.id)}
        />
      )
    }

    case 'blur':
      return <FilteredRegion {...props} filter="blur" />
    case 'pixelate':
      return <FilteredRegion {...props} filter="pixelate" />
    case 'magnify':
      return <Magnifier {...props} />
    case 'spotlight':
      return <Spotlight {...props} />

    case 'step': {
      const s = shape as StepShape
      const label = String(s.index)
      return (
        <Group {...common(shape, props)} x={s.x} y={s.y} onDragEnd={boxDrag(shape.id)}>
          {s.shape === 'square' ? (
            <Rect
              x={-s.radius}
              y={-s.radius}
              width={s.radius * 2}
              height={s.radius * 2}
              cornerRadius={4}
              fill={s.fill}
              {...shadowProps(s)}
            />
          ) : s.shape === 'diamond' ? (
            <RegularPolygon sides={4} radius={s.radius * 1.25} fill={s.fill} {...shadowProps(s)} />
          ) : (
            <Circle radius={s.radius} fill={s.fill} {...shadowProps(s)} />
          )}
          <KonvaText
            x={-s.radius}
            y={-s.fontSize * 0.56}
            width={s.radius * 2}
            align="center"
            text={label}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontStyle="700"
            fontSize={s.fontSize}
            fill={s.color}
            listening={false}
          />
        </Group>
      )
    }

    case 'callout':
      return <Callout {...props} />

    case 'text': {
      const s = shape as TextShape
      return (
        <KonvaText
          {...common(shape, props)}
          x={s.x}
          y={s.y}
          width={s.width}
          text={s.text || 'Double-click to edit'}
          fontFamily={s.fontFamily}
          fontSize={s.fontSize}
          fontStyle={s.fontStyle}
          fill={s.color}
          align={s.align ?? 'left'}
          padding={s.padding ?? 0}
          opacity={(shape.opacity ?? 1) * (s.text ? 1 : 0.55)}
          {...shadowProps(s)}
          onDblClick={() => props.onEditText(shape.id)}
          onDragEnd={boxDrag(shape.id)}
        />
      )
    }

    default:
      return null
  }
}

/**
 * Editing one shape re-renders the whole shape list, so every node that didn't change
 * has to bail out here — otherwise Konva rebuilds (and re-caches) every filter on the
 * canvas on each mouse move.
 */
function ShapeNodeWithClip(props: Props): React.ReactElement | null {
  const rects = props.shape.clipRects
  if (!rects || rects.length === 0) return ShapeNodeInner(props)
  return (
    <Group
      clipFunc={(context) => {
        context.beginPath()
        for (const rect of rects) context.rect(rect.x, rect.y, rect.width, rect.height)
      }}
    >
      {ShapeNodeInner(props)}
    </Group>
  )
}

export const ShapeNode = React.memo(ShapeNodeWithClip, (prev, next) => {
  if (prev.shape !== next.shape) return false
  if (prev.draggable !== next.draggable) return false
  const a = prev.ctx
  const b = next.ctx
  return (
    a.image === b.image &&
    a.cropX === b.cropX &&
    a.cropY === b.cropY &&
    a.cropW === b.cropW &&
    a.cropH === b.cropH &&
    a.zoom === b.zoom
  )
})
