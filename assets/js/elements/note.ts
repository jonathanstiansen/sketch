import { GEOMETRY } from "../generated/manifest.ts"
import { wrapText } from "../hooks/canvas_logic.ts"
import type { Renderer, SvgNode } from "./renderer.ts"

const { charWidth, fontSize, lineHeight, notePadding, textBaseline } = GEOMETRY

function line(content: string, index: number): SvgNode {
  return { tag: "tspan", attrs: { x: 0, y: textBaseline + index * lineHeight }, text: content }
}

export const note: Renderer = ({ width, height, text }) => [
  { tag: "rect", attrs: { "data-note-body": "", x: 0, y: 0, width, height, rx: 6, "stroke-width": 2, class: "note-body" } },
  {
    tag: "svg",
    attrs: { "data-note-clip": "", x: 0, y: 0, width, height, overflow: "hidden", "pointer-events": "none" },
    children: [
      {
        tag: "text",
        attrs: {
          "data-text-body": "",
          transform: `translate(${String(notePadding)} ${String(notePadding)})`,
          "font-size": fontSize,
          class: "text-element fill-base-content",
        },
        children: wrapText(text, width - 2 * notePadding, charWidth).map(line),
      },
    ],
  },
]
