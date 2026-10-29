import type { Renderer } from "./renderer.ts"

export const rectangle: Renderer = ({ width, height }) => [
  {
    tag: "rect",
    attrs: { x: 0, y: 0, width, height, "stroke-width": 2, class: "fill-primary stroke-base-content" },
  },
]
