import { half } from "./half.ts"
import { diamond as sketchedDiamond } from "./hand_drawn.ts"
import type { Renderer } from "./renderer.ts"
import { sketch } from "./segments.ts"

function pair(x: number, y: number): string {
  return [x, y].map(String).join(",")
}

export const diamond: Renderer = ({ width, height, seed }) => {
  const midX = half(width)
  const midY = half(height)
  return [
    {
      tag: "polygon",
      attrs: {
        points: [pair(midX, 0), pair(width, midY), pair(midX, height), pair(0, midY)].join(" "),
        stroke: "transparent",
        "stroke-width": 2,
        class: "fill-primary",
      },
    },
    sketch(sketchedDiamond(width, height, seed)),
  ]
}
