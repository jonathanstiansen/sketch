import type { Point } from "../hooks/canvas_logic.ts"
import { pointsAttribute } from "./dom.ts"
import type { AttributeValue, SvgNode } from "./renderer.ts"

function segment(start: Point, end: Point, attrs: Readonly<Record<string, AttributeValue>>): SvgNode {
  return {
    tag: "line",
    attrs: { x1: start.x, y1: start.y, x2: end.x, y2: end.y, "stroke-linecap": "round", ...attrs },
  }
}

export function segments(
  [start, end]: readonly Point[],
  strokeAttrs: Readonly<Record<string, AttributeValue>> = {},
): readonly SvgNode[] {
  if (start === undefined || end === undefined) return []
  return [
    segment(start, end, { "data-line-hit": "", stroke: "transparent", "stroke-width": 14 }),
    segment(start, end, {
      "data-line-stroke": "",
      "stroke-width": 2,
      "pointer-events": "none",
      class: "stroke-base-content",
      ...strokeAttrs,
    }),
  ]
}

function polyline(points: readonly Point[], attrs: Readonly<Record<string, AttributeValue>>): SvgNode {
  return {
    tag: "polyline",
    attrs: {
      points: pointsAttribute(points),
      fill: "none",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      ...attrs,
    },
  }
}

export function polylines(points: readonly Point[]): readonly SvgNode[] {
  if (points.length < 2) return []
  return [
    polyline(points, { "data-freedraw-hit": "", stroke: "transparent", "stroke-width": 14 }),
    polyline(points, {
      "data-freedraw-stroke": "",
      "stroke-width": 2,
      "pointer-events": "none",
      class: "stroke-base-content",
    }),
  ]
}
