import { pen } from "./hand_drawn.ts"
import type { Renderer } from "./renderer.ts"
import { segments } from "./segments.ts"
import { arrowheadId } from "./style.ts"

export const arrow: Renderer = (shape) =>
  segments(shape.points, pen(shape), shape.style, { "marker-end": `url(#${arrowheadId(shape.style.stroke_color)})` })
