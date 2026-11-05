import { pen } from "./hand_drawn.ts"
import type { Renderer } from "./renderer.ts"
import { segments } from "./segments.ts"

export const line: Renderer = (shape) => segments(shape.points, pen(shape), shape.style)
