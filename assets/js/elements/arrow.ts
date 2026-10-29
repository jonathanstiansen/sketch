import type { Renderer } from "./renderer.ts"
import { segments } from "./segments.ts"

export const arrow: Renderer = ({ points }) => segments(points, { "marker-end": "url(#arrowhead)" })
