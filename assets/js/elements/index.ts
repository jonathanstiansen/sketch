import { MIGRATED_KINDS, type MigratedKind } from "../generated/manifest.ts"
import { diamond } from "./diamond.ts"
import { ellipse } from "./ellipse.ts"
import { rectangle } from "./rectangle.ts"
import type { Renderer } from "./renderer.ts"

export const RENDERERS = { rectangle, diamond, ellipse } as const satisfies Record<MigratedKind, Renderer>

export function isMigratedKind(kind: string | null | undefined): kind is MigratedKind {
  return MIGRATED_KINDS.some((migrated) => migrated === kind)
}

export function rendererFor(kind: string | null | undefined): Renderer | undefined {
  return isMigratedKind(kind) ? RENDERERS[kind] : undefined
}
