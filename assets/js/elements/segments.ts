import type { Point } from "../hooks/canvas_logic.ts"
import { pointsAttribute } from "./dom.ts"
import { line } from "./hand_drawn.ts"
import type { AttributeValue, SvgNode } from "./renderer.ts"
import { strokeAttrs, strokeClass, type ElementStyle } from "./style.ts"

export function sketch(pathData: string, style: ElementStyle, className: string = strokeClass(style)): SvgNode {
  return {
    tag: "path",
    attrs: {
      "data-sketch": "",
      d: pathData,
      fill: "none",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "pointer-events": "none",
      class: className,
      ...strokeAttrs(style, "sketch"),
    },
  }
}

function segment(start: Point, end: Point, attrs: Readonly<Record<string, AttributeValue>>): SvgNode {
  return {
    tag: "line",
    attrs: { x1: start.x, y1: start.y, x2: end.x, y2: end.y, "stroke-linecap": "round", ...attrs },
  }
}

export function segments(
  [start, end]: readonly Point[],
  seed: number,
  style: ElementStyle,
  extraAttrs: Readonly<Record<string, AttributeValue>> = {},
): readonly SvgNode[] {
  if (start === undefined || end === undefined) return []
  return [
    segment(start, end, { "data-line-hit": "", stroke: "transparent", "stroke-width": 14 }),
    {
      tag: "path",
      attrs: {
        "data-line-stroke": "",
        d: line(start, end, seed),
        fill: "none",
        "stroke-linecap": "round",
        "pointer-events": "none",
        class: strokeClass(style),
        ...strokeAttrs(style, "sketch"),
        ...extraAttrs,
      },
    },
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

export function polylines(points: readonly Point[], style: ElementStyle): readonly SvgNode[] {
  if (points.length < 2) return []
  return [
    polyline(points, { "data-freedraw-hit": "", stroke: "transparent", "stroke-width": 14 }),
    polyline(points, {
      "data-freedraw-stroke": "",
      "pointer-events": "none",
      class: strokeClass(style),
      ...strokeAttrs(style, "single"),
    }),
  ]
}
