import type { ElementKind } from "../generated/manifest.ts"
import { isElementKind } from "../hooks/tools.ts"
import { arrow } from "./arrow.ts"
import { diamond } from "./diamond.ts"
import { ellipse } from "./ellipse.ts"
import { freedraw } from "./freedraw.ts"
import { line } from "./line.ts"
import { note } from "./note.ts"
import { rectangle } from "./rectangle.ts"
import type { Renderer } from "./renderer.ts"
import { text } from "./text.ts"

export const RENDERERS = { rectangle, diamond, ellipse, arrow, freedraw, line, text, note } as const satisfies Record<ElementKind, Renderer>

export function rendererFor(kind: string | null): Renderer | undefined {
  return isElementKind(kind) ? RENDERERS[kind] : undefined
}
