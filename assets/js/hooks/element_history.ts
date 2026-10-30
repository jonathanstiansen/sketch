import type { Box, Point } from "./canvas_logic.ts"
import { History, type Recorded } from "./history_logic.ts"
import { isElementKind } from "./tools.ts"
import { focusContext, shortcutFor, type ShortcutInput } from "./shortcuts.ts"
import { isSeed } from "../elements/dom.ts"
import { isStyleToken, styleFrom, type ElementStyle } from "../elements/style.ts"
import { HISTORY_ACTIONS, STYLE_PROPERTIES, type ElementKind, type HistoryActionId, type StyleProperty } from "../generated/manifest.ts"

export interface ElementSnapshot extends Box {
  readonly kind: ElementKind
  readonly points: readonly Point[]
  readonly text: string
  readonly seed: number
  readonly style: ElementStyle
}

export type ElementChange =
  | { readonly event: "commit"; readonly x: number; readonly y: number }
  | { readonly event: "commit_shape"; readonly box: Box; readonly points: readonly Point[]; readonly text?: string }
  | { readonly event: "commit_style"; readonly property: StyleProperty; readonly value: string }

export type ElementHistory = History<ElementSnapshot, ElementChange>

export interface HistoryKeyInput extends ShortcutInput {
  readonly editable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && Number.isInteger(value.x) && Number.isInteger(value.y)
}

function hasStyle(value: Record<string, unknown>): boolean {
  return STYLE_PROPERTIES.every((property) => isStyleToken(property, value[property]))
}

function hasBox<T extends Record<string, unknown>>(value: T): value is T & Box {
  return ["x", "y", "width", "height"].every((key) => Number.isInteger(value[key]))
}

export function recordedElement(value: unknown): Recorded<ElementSnapshot> | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") return undefined
  const { kind, points, seed } = value
  if (typeof kind !== "string" || !isElementKind(kind) || !isSeed(seed) || !hasStyle(value)) return undefined
  if (!Array.isArray(points) || !points.every(isPoint) || !hasBox(value)) return undefined
  return {
    id: value.id,
    snapshot: {
      kind,
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      points: points.map(({ x, y }) => ({ x, y })),
      text: value.text,
      seed,
      style: styleFrom((property) => value[property]),
    },
  }
}

export function recordedElements(value: unknown): Recorded<ElementSnapshot>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((element) => recordedElement(element) ?? [])
}

export function createPayload({ kind, x, y, width, height, points, text, seed, style }: ElementSnapshot, dragId: string): Record<string, unknown> {
  return { kind, drag_id: dragId, x, y, width, height, points, text, seed, ...style }
}

export function changePayload(elementId: string, change: ElementChange, dragId: string): Record<string, unknown> {
  if (change.event === "commit_style") return { element_id: elementId, [change.property]: change.value }
  const ref = { element_id: elementId, drag_id: dragId }
  if (change.event === "commit") return { ...ref, x: change.x, y: change.y }
  const shape = { ...ref, ...change.box, points: change.points }
  return change.text === undefined ? shape : { ...shape, text: change.text }
}

export function historyActionFor(input: HistoryKeyInput): HistoryActionId | undefined {
  const shortcut = shortcutFor(input, focusContext(input.editable))
  return shortcut?.group === "history" ? shortcut.action : undefined
}

export function isHistoryAction(value: unknown): value is HistoryActionId {
  return HISTORY_ACTIONS.some(({ id }) => id === value)
}
