import { label } from "./label.ts"
import { half } from "./half.ts"
import { ellipse as sketchedEllipse, pen } from "./hand_drawn.ts"
import type { Renderer } from "./renderer.ts"
import { sketch } from "./segments.ts"
import { fillClass } from "./style.ts"

export const ellipse: Renderer = (shape) => {
  const { width, height, style } = shape
  return [
    {
      tag: "ellipse",
      attrs: {
        cx: half(width),
        cy: half(height),
        rx: half(width),
        ry: half(height),
        stroke: "transparent",
        "stroke-width": 2,
        class: fillClass(style),
      },
    },
    sketch(sketchedEllipse(width, height, pen(shape)), style),
    ...label(shape),
  ]
}
