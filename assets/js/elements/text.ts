import { GEOMETRY } from "../generated/manifest.ts"
import { textLines } from "../hooks/canvas_logic.ts"
import type { Renderer, SvgNode } from "./renderer.ts"

function line(content: string, index: number): SvgNode {
  return { tag: "tspan", attrs: { x: 0, y: GEOMETRY.textBaseline + index * GEOMETRY.lineHeight }, text: content }
}

export const text: Renderer = ({ width, height, text: content }) => [
  { tag: "rect", attrs: { "data-text-hit": "", x: 0, y: 0, width, height, fill: "transparent" } },
  {
    tag: "text",
    attrs: {
      "data-text-body": "",
      "font-size": GEOMETRY.fontSize,
      "pointer-events": "none",
      class: "text-element fill-base-content",
    },
    children: textLines(content).map(line),
  },
]
