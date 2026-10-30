import type { Renderer } from "./renderer.ts"
import { polylines } from "./segments.ts"

export const freedraw: Renderer = ({ points, style }) => polylines(points, style)
