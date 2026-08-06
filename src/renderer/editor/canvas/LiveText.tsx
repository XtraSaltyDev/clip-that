import React, { useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Group, Rect } from 'react-konva'
import type { OcrWord } from '@shared/types'
import { toLines } from '../../shared/extract'
import { useEditor } from '../store'

/**
 * Live Text: the words the OCR pass found, laid back over the screenshot as
 * invisible hit targets. Drag across them to select, exactly like text on a page —
 * the screenshot stops being a picture and starts being readable content.
 */
export default function LiveText({ zoom }: { zoom: number }): React.ReactElement | null {
  const ocr = useEditor((s) => s.ocr)
  const selection = useEditor((s) => s.liveSelection)
  const setSelection = useEditor((s) => s.setLiveSelection)
  const [hover, setHover] = useState<number | null>(null)
  const anchor = useRef<number | null>(null)

  // Reading order: group into lines by vertical overlap, then left-to-right.
  const words = useMemo(() => orderWords(ocr?.words ?? []), [ocr])

  if (words.length === 0) return null

  const [lo, hi] = selection ? [Math.min(...selection), Math.max(...selection)] : [-1, -2]

  const beginAt = (index: number) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true
    anchor.current = index
    setSelection([index, index])
  }

  const extendTo = (index: number) => () => {
    setHover(index)
    if (anchor.current === null) return
    setSelection([anchor.current, index])
  }

  return (
    <Group
      onMouseUp={() => {
        anchor.current = null
      }}
      onMouseLeave={() => setHover(null)}
    >
      {words.map((word, i) => {
        const selected = i >= lo && i <= hi
        return (
          <Rect
            key={`${i}-${word.bbox.x}-${word.bbox.y}`}
            x={word.bbox.x - 1}
            y={word.bbox.y - 1}
            width={word.bbox.width + 2}
            height={word.bbox.height + 2}
            cornerRadius={2 / zoom}
            fill={selected ? '#4f8cff' : hover === i ? '#4f8cff' : 'rgba(0,0,0,0.001)'}
            opacity={selected ? 0.36 : hover === i ? 0.16 : 1}
            onMouseDown={beginAt(i)}
            onMouseEnter={extendTo(i)}
            onMouseMove={extendTo(i)}
            onDblClick={() => setSelection([i, i])}
          />
        )
      })}
    </Group>
  )
}

/** Sort OCR words into human reading order. */
export function orderWords(words: OcrWord[]): OcrWord[] {
  return toLines(words).flat()
}

/** Text for the current Live Text selection, with line breaks preserved. */
export function selectedText(words: OcrWord[], range: [number, number] | null): string {
  if (!range) return ''
  const [lo, hi] = [Math.min(...range), Math.max(...range)]
  const picked = words.slice(lo, hi + 1)
  if (picked.length === 0) return ''

  let out = picked[0].text
  for (let i = 1; i < picked.length; i++) {
    const prev = picked[i - 1]
    const cur = picked[i]
    // A big vertical step means a new line, not a space.
    const newLine = cur.bbox.y - prev.bbox.y > Math.max(6, prev.bbox.height * 0.6)
    out += newLine ? `\n${cur.text}` : ` ${cur.text}`
  }
  return out
}
