import { pen, rectangle as sketchedRectangle } from "./hand_drawn.ts"
import type { Renderer } from "./renderer.ts"
import { sketch } from "./segments.ts"
import { fillClass } from "./style.ts"

export const rectangle: Renderer = (shape) => {
  const { width, height, style } = shape
  return [
    {
      tag: "rect",
      attrs: { x: 0, y: 0, width, height, stroke: "transparent", "stroke-width": 2, class: fillClass(style) },
    },
    sketch(sketchedRectangle(width, height, pen(shape)), style),
  ]
}
