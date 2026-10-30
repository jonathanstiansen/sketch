import type { Renderer } from "./renderer.ts"
import { segments } from "./segments.ts"

export const line: Renderer = ({ points, seed, style }) => segments(points, seed, style)
