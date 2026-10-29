import { half } from "./half.ts"
import type { Renderer } from "./renderer.ts"

export const ellipse: Renderer = ({ width, height }) => [
  {
    tag: "ellipse",
    attrs: {
      cx: half(width),
      cy: half(height),
      rx: half(width),
      ry: half(height),
      "stroke-width": 2,
      class: "fill-primary stroke-base-content",
    },
  },
]
