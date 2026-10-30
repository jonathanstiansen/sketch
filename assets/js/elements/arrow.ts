import type { Renderer } from "./renderer.ts"
import { segments } from "./segments.ts"

export const arrow: Renderer = ({ points, seed }) => segments(points, seed, { "marker-end": "url(#arrowhead)" })
