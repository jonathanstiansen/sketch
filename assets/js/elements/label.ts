import { ANCHOR_SCALE, GEOMETRY } from "../generated/manifest.ts"
import { wrapText } from "../hooks/canvas_logic.ts"
import type { LocalShape, SvgNode } from "./renderer.ts"
import { inkClass } from "./style.ts"

export interface LabelOffset {
  readonly x: number
  readonly y: number
}

export const DEFAULT_LABEL: LabelOffset = { x: ANCHOR_SCALE / 2, y: ANCHOR_SCALE / 2 }

const { charWidth, fontSize, lineHeight, notePadding, textBaseline } = GEOMETRY

export function clampLabel({ x, y }: LabelOffset): LabelOffset {
  return { x: Math.min(ANCHOR_SCALE, Math.max(0, x)), y: Math.min(ANCHOR_SCALE, Math.max(0, y)) }
}

export function labelPoint(width: number, height: number, { x, y }: LabelOffset): LabelOffset {
  return { x: Math.floor((width * x) / ANCHOR_SCALE), y: Math.floor((height * y) / ANCHOR_SCALE) }
}

function within(at: number, block: number, size: number): number {
  if (block >= size) return Math.floor(size / 2)
  const half = Math.floor((block + 1) / 2)
  return Math.min(size - half, Math.max(half, at))
}

export function placedLabel(width: number, height: number, offset: LabelOffset, blockWidth: number, blockHeight: number): LabelOffset {
  const { x, y } = labelPoint(width, height, offset)
  return { x: within(x, blockWidth, width), y: within(y, blockHeight, height) }
}

export function label(shape: LocalShape): SvgNode[] {
  const { width, height, text, style } = shape
  if (text === "") return []
  const lines = wrapText(text, width - 2 * notePadding, charWidth)
  const blockWidth = Math.max(...lines.map((line) => Array.from(line).length)) * charWidth
  const blockHeight = lines.length * lineHeight
  const { x, y } = placedLabel(width, height, shape.label ?? DEFAULT_LABEL, blockWidth, blockHeight)
  const top = y - Math.floor(blockHeight / 2) + textBaseline
  return [
    {
      tag: "svg",
      attrs: { "data-label-clip": "", x: 0, y: 0, width, height, overflow: "hidden", "pointer-events": "none" },
      children: [
        {
          tag: "text",
          attrs: { "data-label": "", "text-anchor": "middle", "font-size": fontSize, class: `text-element ${inkClass(style)}` },
          children: lines.map((content, index) => ({ tag: "tspan", attrs: { x, y: top + index * lineHeight }, text: content })),
        },
      ],
    },
  ]
}
