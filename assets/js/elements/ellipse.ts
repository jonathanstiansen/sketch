import { half } from "./half.ts"
import { ellipse as sketchedEllipse } from "./hand_drawn.ts"
import type { Renderer } from "./renderer.ts"
import { sketch } from "./segments.ts"
import { fillClass } from "./style.ts"

export const ellipse: Renderer = ({ width, height, seed, style }) => [
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
  sketch(sketchedEllipse(width, height, seed), style),
]
