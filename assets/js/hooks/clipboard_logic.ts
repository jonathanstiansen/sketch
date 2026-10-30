import { MIN_SIZE, clamp, isBlankText, textBox, textLines, type Box, type Point, type Size } from "./canvas_logic.ts"
import type { ElementSnapshot } from "./element_history.ts"
import { focusContext, shortcutFor, type ShortcutInput } from "./shortcuts.ts"
import { isElementKind } from "./tools.ts"
import { isSeed } from "../elements/dom.ts"
import { isStyleToken, styleForKind, styleFrom, type ElementStyle } from "../elements/style.ts"
import { CLIPBOARD_ACTIONS, GEOMETRY, KIND_SPECS, STYLE_PROPERTIES, type ClipboardActionId } from "../generated/manifest.ts"

export const ENVELOPE_TYPE = "sketch/elements"
export const ENVELOPE_VERSION = 1
export const DUPLICATE_OFFSET = 10
export const MAX_PASTED_ELEMENTS = 100

export interface ClipboardKeyInput extends ShortcutInput {
  readonly editable: boolean
}

export type Decoded =
  | { readonly status: "elements"; readonly elements: readonly ElementSnapshot[] }
  | { readonly status: "text"; readonly text: string }
  | { readonly status: "rejected"; readonly reason: string }

export function isClipboardAction(value: unknown): value is ClipboardActionId {
  return CLIPBOARD_ACTIONS.some(({ id }) => id === value)
}

export function clipboardActionFor(input: ClipboardKeyInput): ClipboardActionId | undefined {
  const action = shortcutFor(input, focusContext(input.editable))?.action
  return isClipboardAction(action) ? action : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function codePoints(text: string): number {
  return Array.from(text).length
}

function boxOf(value: Record<string, unknown>, points: boolean): Box | undefined {
  const { x, y, width, height } = value
  if (!isCoordinate(x) || !isCoordinate(y) || !isCoordinate(width) || !isCoordinate(height)) return undefined
  if (!points && (width < MIN_SIZE || height < MIN_SIZE)) return undefined
  if (x + width > GEOMETRY.canvasWidth || y + height > GEOMETRY.canvasHeight) return undefined
  return { x, y, width, height }
}

function pointsOf(value: unknown, box: Box, kind: keyof typeof KIND_SPECS): Point[] | undefined {
  if (!Array.isArray(value)) return undefined
  const { geometry } = KIND_SPECS[kind]
  const [min, max] = geometry === "box" ? [0, 0] : [geometry.points.min, geometry.points.max]
  if (value.length < min || value.length > max) return undefined
  const points: Point[] = []
  for (const point of value) {
    if (!isRecord(point) || !isCoordinate(point.x) || !isCoordinate(point.y)) return undefined
    if (point.x > box.width || point.y > box.height) return undefined
    points.push({ x: point.x, y: point.y })
  }
  return points
}

function textOf(value: unknown, kind: keyof typeof KIND_SPECS): string | undefined {
  if (typeof value !== "string" || value.includes("\0") || codePoints(value) > GEOMETRY.maxTextLength) return undefined
  const rule = KIND_SPECS[kind].text
  if (rule === "none") return value === "" ? value : undefined
  return rule === "required" && isBlankText(value) ? undefined : value
}

function styleOf(value: Record<string, unknown>, kind: keyof typeof KIND_SPECS): ElementStyle | undefined {
  if (!STYLE_PROPERTIES.every((property) => isStyleToken(property, value[property]))) return undefined
  return styleForKind(kind, styleFrom((property) => value[property]))
}

export function validElement(value: unknown): ElementSnapshot | undefined {
  if (!isRecord(value)) return undefined
  const { kind, seed } = value
  if (typeof kind !== "string" || !isElementKind(kind) || !isSeed(seed)) return undefined
  const box = boxOf(value, KIND_SPECS[kind].geometry !== "box")
  if (box === undefined) return undefined
  const points = pointsOf(value.points, box, kind)
  const text = textOf(value.text, kind)
  const style = styleOf(value, kind)
  if (points === undefined || text === undefined || style === undefined) return undefined
  return { kind, ...box, points, text, seed, style }
}

function flat({ kind, x, y, width, height, points, text, seed, style }: ElementSnapshot): Record<string, unknown> {
  const { stroke_color, fill_color, stroke_width, stroke_style } = style
  return { kind, x, y, width, height, points, text, stroke_color, fill_color, stroke_width, stroke_style, seed }
}

export function encodeElements(elements: readonly ElementSnapshot[]): string {
  return JSON.stringify({ type: ENVELOPE_TYPE, version: ENVELOPE_VERSION, elements: elements.map(flat) })
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function decodedEnvelope(envelope: Record<string, unknown>): Decoded {
  if (envelope.version !== ENVELOPE_VERSION) return { status: "rejected", reason: "Can't paste: unsupported clipboard version" }
  const { elements } = envelope
  if (!Array.isArray(elements) || elements.length === 0 || elements.length > MAX_PASTED_ELEMENTS) {
    return { status: "rejected", reason: "Can't paste: no elements in the clipboard" }
  }
  const valid = elements.map(validElement)
  const snapshots = valid.flatMap((element) => element ?? [])
  if (snapshots.length !== valid.length) return { status: "rejected", reason: "Can't paste: the copied elements are invalid" }
  return { status: "elements", elements: snapshots }
}

export function decodeClipboard(text: string): Decoded {
  const parsed = parsedJson(text)
  if (isRecord(parsed) && parsed.type === ENVELOPE_TYPE) return decodedEnvelope(parsed)
  if (text.includes(ENVELOPE_TYPE)) return { status: "rejected", reason: "Can't paste: the copied elements are invalid" }
  return { status: "text", text }
}

export function groupBox(elements: readonly Box[]): Box | undefined {
  const [first, ...rest] = elements
  if (first === undefined) return undefined
  let left = first.x
  let top = first.y
  let right = first.x + first.width
  let bottom = first.y + first.height
  for (const { x, y, width, height } of rest) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + width)
    bottom = Math.max(bottom, y + height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function translated(elements: readonly ElementSnapshot[], delta: Point): ElementSnapshot[] {
  return elements.map((element) => ({ ...element, x: element.x + delta.x, y: element.y + delta.y }))
}

export function translateInto(elements: readonly ElementSnapshot[], wanted: Point, canvas: Size): ElementSnapshot[] {
  const bounds = groupBox(elements)
  if (bounds === undefined) return []
  const delta = {
    x: clamp(bounds.x + wanted.x, canvas.width - bounds.width) - bounds.x,
    y: clamp(bounds.y + wanted.y, canvas.height - bounds.height) - bounds.y,
  }
  return translated(elements, delta)
}

export function duplicated(elements: readonly ElementSnapshot[], canvas: Size): ElementSnapshot[] {
  return translateInto(elements, { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET }, canvas)
}

export function placedAround(elements: readonly ElementSnapshot[], center: Point, canvas: Size): ElementSnapshot[] {
  const bounds = groupBox(elements)
  if (bounds === undefined) return []
  const wanted = {
    x: Math.round(center.x - bounds.width / 2) - bounds.x,
    y: Math.round(center.y - bounds.height / 2) - bounds.y,
  }
  return translateInto(elements, wanted, canvas)
}

export interface TextPaste {
  readonly at: Point
  readonly measure: (line: string) => number
  readonly lineHeight: number
  readonly canvas: Size
  readonly seed: number
  readonly style: ElementStyle
}

export function pastedText(text: string, { at, measure, lineHeight, canvas, seed, style }: TextPaste): ElementSnapshot | undefined {
  const normalized = textLines(text).join("\n")
  const fits = textOf(normalized, "text")
  if (fits === undefined) return undefined
  const box = textBox(at, fits, measure, lineHeight, canvas)
  if (box.height < textLines(fits).length * lineHeight) return undefined
  return { kind: "text", ...box, points: [], text: fits, seed, style: styleForKind("text", style) }
}
