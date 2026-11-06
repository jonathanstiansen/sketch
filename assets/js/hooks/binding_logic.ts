import { ANCHOR_SCALE, BINDING_KINDS, BINDING_TARGET_KINDS, type ElementKind } from "../generated/manifest.ts"
import { absolutePoints, shapeAround, type Box, type Point, type Shape, type Size } from "./canvas_logic.ts"

export type BindingEnd = "start" | "end"

export const BINDING_ENDS: readonly BindingEnd[] = ["start", "end"]

export interface Anchor {
  readonly x: number
  readonly y: number
}

export interface Binding {
  readonly target: string
  readonly anchor: Anchor
}

export type Bindings = Readonly<Partial<Record<BindingEnd, Binding>>>

export function bindingsFrom(entries: readonly (readonly [BindingEnd, Binding])[]): Bindings {
  const bindings: Partial<Record<BindingEnd, Binding>> = {}
  for (const [end, binding] of entries) bindings[end] = binding
  return bindings
}

export function bindsEnds(kind: ElementKind): boolean {
  return (BINDING_KINDS as readonly string[]).includes(kind)
}

export function bindsTo(kind: ElementKind): boolean {
  return (BINDING_TARGET_KINDS as readonly string[]).includes(kind)
}

function perMille(offset: number, length: number): number {
  if (length === 0) return 0
  return Math.min(ANCHOR_SCALE, Math.max(0, Math.floor((offset * ANCHOR_SCALE) / length)))
}

export function anchorFor(point: Point, box: Box): Anchor {
  return { x: perMille(point.x - box.x, box.width), y: perMille(point.y - box.y, box.height) }
}

export function anchorPoint(box: Box, anchor: Anchor): Point {
  return {
    x: box.x + Math.floor((box.width * anchor.x) / ANCHOR_SCALE),
    y: box.y + Math.floor((box.height * anchor.y) / ANCHOR_SCALE),
  }
}

export function resolvedShape(shape: Shape, bindings: Bindings, boxOf: (id: string) => Box | undefined, canvas: Size): Shape {
  const stored = absolutePoints(shape)
  if (stored.length !== 2) return shape
  const ends = BINDING_ENDS.map((end, index) => {
    const binding = bindings[end]
    const box = binding === undefined ? undefined : boxOf(binding.target)
    return box === undefined || binding === undefined ? stored[index] : anchorPoint(box, binding.anchor)
  })
  return ends.every((point) => point !== undefined) ? shapeAround(ends, canvas) : shape
}

export function boxContains(box: Box, point: Point): boolean {
  return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
}

export function boundTargets(bindings: Bindings): string[] {
  return BINDING_ENDS.flatMap((end) => bindings[end]?.target ?? [])
}
