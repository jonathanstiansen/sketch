import type { Point } from "../hooks/canvas_logic.ts"
import type { AttributeValue, Renderer, SvgNode } from "./renderer.ts"

function segment(start: Point, end: Point, attrs: Readonly<Record<string, AttributeValue>>): SvgNode {
  return {
    tag: "line",
    attrs: { x1: start.x, y1: start.y, x2: end.x, y2: end.y, "stroke-linecap": "round", ...attrs },
  }
}

export const line: Renderer = ({ points: [start, end] }) => {
  if (start === undefined || end === undefined) return []
  return [
    segment(start, end, { "data-line-hit": "", stroke: "transparent", "stroke-width": 14 }),
    segment(start, end, {
      "data-line-stroke": "",
      "stroke-width": 2,
      "pointer-events": "none",
      class: "stroke-base-content",
    }),
  ]
}
