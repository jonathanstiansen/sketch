import { BINDING_ENDS, bindingsFrom, type Binding, type BindingEnd, type Bindings } from "./binding_logic.ts"
import type { Box, Point } from "./canvas_logic.ts"
import { History, type Recorded } from "./history_logic.ts"
import { isElementKind } from "./tools.ts"
import { focusContext, shortcutFor, type ShortcutInput } from "./shortcuts.ts"
import { isSeed } from "../elements/dom.ts"
import { isStyleToken, styleFrom, type ElementStyle } from "../elements/style.ts"
import { HISTORY_ACTIONS, STYLE_PROPERTIES, type ClientEventPayloads, type ElementKind, type HistoryActionId, type StyleProperty } from "../generated/manifest.ts"

export interface ElementSnapshot extends Box {
  readonly kind: ElementKind
  readonly points: readonly Point[]
  readonly text: string
  readonly seed: number
  readonly style: ElementStyle
  readonly bindings?: Bindings
}

export type BindingChange = Readonly<Partial<Record<BindingEnd, Binding | null>>>

export type ElementChange =
  | { readonly event: "commit"; readonly x: number; readonly y: number }
  | {
      readonly event: "commit_shape"
      readonly box: Box
      readonly points: readonly Point[]
      readonly text?: string
      readonly bindings?: BindingChange
      readonly label?: { readonly x: number; readonly y: number }
    }
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

function eventBinding(value: Record<string, unknown>, end: BindingEnd): Binding | undefined {
  const target = value[`${end}_target_id`]
  const x = value[`${end}_anchor_x`]
  const y = value[`${end}_anchor_y`]
  return typeof target === "string" && typeof x === "number" && typeof y === "number" ? { target, anchor: { x, y } } : undefined
}

function eventBindings(value: Record<string, unknown>): Bindings {
  return bindingsFrom(
    BINDING_ENDS.flatMap((end) => {
      const binding = eventBinding(value, end)
      return binding === undefined ? [] : [[end, binding] as const]
    }),
  )
}

function bindingPayload(binding: Binding | null): { target_id: string; anchor_x: number; anchor_y: number } | null {
  return binding === null ? null : { target_id: binding.target, anchor_x: binding.anchor.x, anchor_y: binding.anchor.y }
}

function bindingPayloads(bindings: BindingChange): { start_binding?: ReturnType<typeof bindingPayload>; end_binding?: ReturnType<typeof bindingPayload> } {
  return Object.fromEntries(
    BINDING_ENDS.flatMap((end) => {
      const binding = bindings[end]
      return binding === undefined ? [] : [[`${end}_binding`, bindingPayload(binding)]]
    }),
  )
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
      bindings: eventBindings(value),
    },
  }
}

export function recordedElements(value: unknown): Recorded<ElementSnapshot>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((element) => recordedElement(element) ?? [])
}

export function createPayload({ kind, x, y, width, height, points, text, seed, style, bindings = {} }: ElementSnapshot, dragId: string): ClientEventPayloads["create_element"] {
  return { kind, drag_id: dragId, x, y, width, height, points, text, seed, ...style, ...bindingPayloads(bindings) }
}

export function positionPayload(elementId: string, { x, y }: Extract<ElementChange, { event: "commit" }>, dragId: string): ClientEventPayloads["commit"] {
  return { element_id: elementId, drag_id: dragId, x, y }
}

export function shapePayload(elementId: string, { box, points, text, bindings = {}, label }: Extract<ElementChange, { event: "commit_shape" }>, dragId: string): ClientEventPayloads["commit_shape"] {
  const shape = { element_id: elementId, drag_id: dragId, ...box, points, ...bindingPayloads(bindings), ...(label === undefined ? {} : { label }) }
  return text === undefined ? shape : { ...shape, text }
}

export function stylePayload(elementId: string, { property, value }: Extract<ElementChange, { event: "commit_style" }>): ClientEventPayloads["commit_style"] {
  return { element_id: elementId, [property]: value }
}

export function historyActionFor(input: HistoryKeyInput): HistoryActionId | undefined {
  const shortcut = shortcutFor(input, focusContext(input.editable))
  return shortcut?.group === "history" ? shortcut.action : undefined
}

export function isHistoryAction(value: unknown): value is HistoryActionId {
  return HISTORY_ACTIONS.some(({ id }) => id === value)
}
