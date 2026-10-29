import type { Renderer } from "./renderer.ts"

function pair(x: number, y: number): string {
  return [x, y].map(String).join(",")
}

export const diamond: Renderer = ({ width, height }) => {
  const midX = width / 2
  const midY = height / 2
  return [
    {
      tag: "polygon",
      attrs: {
        points: [pair(midX, 0), pair(width, midY), pair(midX, height), pair(0, midY)].join(" "),
        "stroke-width": 2,
        class: "fill-primary stroke-base-content",
      },
    },
  ]
}
