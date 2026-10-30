import { clamp, groupBox, type Box, type Hittable, type Point, type RemotePreviews, type Shape, type Size } from "./canvas_logic.ts"
import { focusContext, shortcutFor, type ShortcutInput } from "./shortcuts.ts"
import { appliesTo, type ElementStyle } from "../elements/style.ts"
import { type ElementKind, type StyleProperty } from "../generated/manifest.ts"

export type Selection = readonly string[]

export const EMPTY_SELECTION: Selection = []

export function toggled(selection: Selection, id: string): Selection {
  return selection.includes(id) ? selection.filter((selected) => selected !== id) : [...selection, id]
}

export function united(selection: Selection, ids: readonly string[]): Selection {
  return [...new Set([...selection, ...ids])]
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

export function marqueeBox(start: Point, end: Point): Box {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

export function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

export function marqueeHits(elements: readonly Hittable[], marquee: Box): string[] {
  return elements.filter(({ box }) => intersects(box, marquee)).map(({ id }) => id)
}

export function marqueeSelection(current: Selection, hits: readonly string[], additive: boolean): Selection {
  return additive ? united(current, hits) : united(EMPTY_SELECTION, hits)
}

export function clampGroupDelta(boxes: readonly Box[], delta: Point, canvas: Size): Point {
  const bounds = groupBox(boxes)
  if (bounds === undefined) return { x: 0, y: 0 }
  return {
    x: clamp(bounds.x + delta.x, canvas.width - bounds.width) - bounds.x,
    y: clamp(bounds.y + delta.y, canvas.height - bounds.height) - bounds.y,
  }
}

export function translatedShape({ box, points }: Shape, delta: Point): Shape {
  return { box: { ...box, x: box.x + delta.x, y: box.y + delta.y }, points }
}

export interface GroupMove {
  readonly delta: Point
  readonly shapes: readonly Shape[]
}

export function movedGroup(origins: readonly Shape[], wanted: Point, canvas: Size): GroupMove {
  const delta = clampGroupDelta(
    origins.map(({ box }) => box),
    wanted,
    canvas,
  )
  return { delta, shapes: origins.map((origin) => translatedShape(origin, delta)) }
}

export interface GroupPreviewEntry extends Box {
  readonly element_id: string
  readonly base_version: number
  readonly points: readonly Point[]
}

export interface GroupPreview {
  readonly drag_id: string
  readonly seq: number
  readonly elements: readonly GroupPreviewEntry[]
}

export interface GroupMember {
  readonly elementId: string
  readonly baseVersion: number
  readonly shape: Shape
}

export function groupPreview(dragId: string, seq: number, members: readonly GroupMember[]): GroupPreview {
  return {
    drag_id: dragId,
    seq,
    elements: members.map(({ elementId, baseVersion, shape }) => ({
      element_id: elementId,
      base_version: baseVersion,
      ...shape.box,
      points: shape.points,
    })),
  }
}

export function acceptedGroupEntries(
  previews: RemotePreviews,
  group: GroupPreview,
  knownVersion: (elementId: string) => number | undefined,
): GroupPreviewEntry[] {
  return group.elements.filter((entry) => {
    const known = knownVersion(entry.element_id)
    if (known === undefined) return false
    const ref = { element_id: entry.element_id, drag_id: group.drag_id, seq: group.seq, base_version: entry.base_version }
    return previews.accept(ref, known)
  })
}

export interface Styled {
  readonly kind: ElementKind
  readonly style: ElementStyle
}

export interface PropertyState {
  readonly applies: boolean
  readonly value: string | undefined
  readonly mixed: boolean
}

export function propertyState(elements: readonly Styled[], property: StyleProperty): PropertyState {
  const values = new Set(elements.filter(({ kind }) => appliesTo(kind, property)).map(({ style }) => style[property]))
  const [only] = values
  return { applies: values.size > 0, value: values.size === 1 ? only : undefined, mixed: values.size > 1 }
}

export interface Restyle {
  readonly id: string
  readonly before: string
}

export function restyleTargets(elements: readonly (Styled & { readonly id: string })[], property: StyleProperty, value: string): Restyle[] {
  return elements.flatMap(({ id, kind, style }) => (appliesTo(kind, property) && style[property] !== value ? [{ id, before: style[property] }] : []))
}

export interface SelectionKeyInput extends ShortcutInput {
  readonly editable: boolean
}

export function selectsAll(input: SelectionKeyInput): boolean {
  const shortcut = shortcutFor(input, focusContext(input.editable))
  return shortcut?.group === "selection"
}

export function erasedWithSelection(hits: readonly string[], selection: Selection): string[] {
  return hits.some((id) => selection.includes(id)) ? [...united(hits, selection)] : [...hits]
}
