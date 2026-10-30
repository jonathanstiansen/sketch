import type { Renderer } from "./renderer.ts"
import { segments } from "./segments.ts"
import { arrowheadId } from "./style.ts"

export const arrow: Renderer = ({ points, seed, style }) =>
  segments(points, seed, style, { "marker-end": `url(#${arrowheadId(style.stroke_color)})` })
