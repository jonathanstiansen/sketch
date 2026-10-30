import { ENDPOINTS, type Point, type Size } from "./canvas_logic.ts"
import {
  DEFAULT_TOOL,
  ELEMENT_KINDS,
  KIND_SPECS,
  REQUIRED_TEXT_KINDS,
  TEXT_KINDS,
  TOOLS as TOOL_SPECS,
  TYPED_KINDS,
  type ElementKind,
  type KindSpec,
  type RequiredTextKind,
  type TextKind,
  type ToolId,
  type ToolSpec,
  type TypedKind,
} from "../generated/manifest.ts"

export { DEFAULT_TOOL, type ToolId }

export interface Tool {
  id: ToolId
  letter: string
  digit: string | null
  enabled: boolean
}

function shortcutKeys({ id, keys }: ToolSpec): Pick<Tool, "letter" | "digit"> {
  const [letter, digit] = keys
  if (letter === undefined) throw new Error(`tool ${id} has no shortcut key`)
  return { letter: letter.toLowerCase(), digit: digit ?? null }
}

export const TOOLS: readonly Tool[] = TOOL_SPECS.map((tool) => ({ id: tool.id, enabled: tool.enabled, ...shortcutKeys(tool) }))

export type PreviewKind = NonNullable<(typeof TOOL_SPECS)[number]["creates"]>

export type DrawnKind = Exclude<PreviewKind, TypedKind>

export type DrawGesture = (typeof KIND_SPECS)[DrawnKind]["drawGesture"]

export function isElementKind(value: string | null | undefined): value is ElementKind {
  return ELEMENT_KINDS.some((kind) => kind === value)
}

export function isTextKind(value: string | undefined): value is TextKind {
  return TEXT_KINDS.some((kind) => kind === value)
}

export function requiresText(kind: ElementKind): kind is RequiredTextKind {
  return REQUIRED_TEXT_KINDS.some((required) => required === kind)
}

export function isTypedKind(kind: ElementKind): kind is TypedKind {
  return TYPED_KINDS.some((typed) => typed === kind)
}

export function isPreviewKind(value: string): value is PreviewKind {
  return TOOL_SPECS.some(({ creates }) => creates === value)
}

export function isDrawnKind(value: string): value is DrawnKind {
  return isPreviewKind(value) && !isTypedKind(value)
}

export const DRAWN_KINDS: readonly DrawnKind[] = ELEMENT_KINDS.filter(isDrawnKind)

function createdKind(tool: string): PreviewKind | undefined {
  return TOOL_SPECS.find(({ id }) => id === tool)?.creates ?? undefined
}

export function drawnKind(tool: string): DrawnKind | undefined {
  const kind = createdKind(tool)
  return kind !== undefined && isDrawnKind(kind) ? kind : undefined
}

export function typedKind(tool: string): TypedKind | undefined {
  const kind = createdKind(tool)
  return kind !== undefined && isTypedKind(kind) ? kind : undefined
}

export function drawGesture(kind: DrawnKind): DrawGesture {
  return KIND_SPECS[kind].drawGesture
}

export function defaultSize(kind: ElementKind): Size {
  return KIND_SPECS[kind].defaultSize
}

export type SelectionHandles = "corners" | "endpoints" | "none"

function hasEndpoints({ geometry }: KindSpec): boolean {
  return geometry !== "box" && geometry.points.min === ENDPOINTS.length && geometry.points.max === ENDPOINTS.length
}

export function selectionHandles(kind: string | undefined): SelectionHandles {
  if (!isElementKind(kind)) return "corners"
  if (hasEndpoints(KIND_SPECS[kind])) return "endpoints"
  return isTypedKind(kind) ? "none" : "corners"
}

export interface KeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  editable: boolean
}

export type PointerAction = "pan" | "draw" | "text" | "erase" | "move" | "resize" | "deselect" | "none"

export interface PointerInput {
  button: number
  tool: ToolId
  spaceHeld: boolean
  onElement: boolean
  onHandle: boolean
}

const PRIMARY_BUTTON = 0
const MIDDLE_BUTTON = 1

function isShortcutInput(input: KeyInput): boolean {
  return !input.editable && !input.ctrlKey && !input.metaKey && !input.altKey
}

function toolForKey(key: string): Tool | undefined {
  const pressed = key.toLowerCase()
  return TOOLS.find((tool) => tool.letter === pressed || tool.digit === pressed)
}

export function selectTool(current: ToolId, requested: string): ToolId {
  const tool = TOOLS.find(({ id }) => id === requested)
  return tool?.enabled === true ? tool.id : current
}

export function nextTool(current: ToolId, input: KeyInput): ToolId {
  if (!isShortcutInput(input)) return current
  if (input.key === "Escape") return DEFAULT_TOOL
  return selectTool(current, toolForKey(input.key)?.id ?? current)
}

export function togglesHelp(input: KeyInput): boolean {
  return isShortcutInput(input) && input.key === "?"
}

export function deletesSelection(input: KeyInput): boolean {
  return isShortcutInput(input) && (input.key === "Delete" || input.key === "Backspace")
}

export function isPanKey(input: KeyInput): boolean {
  return isShortcutInput(input) && input.key === " "
}

function selectionAction(onElement: boolean, onHandle: boolean): PointerAction {
  if (onHandle) return "resize"
  return onElement ? "move" : "deselect"
}

export function pointerAction({ button, tool, spaceHeld, onElement, onHandle }: PointerInput): PointerAction {
  if (button === MIDDLE_BUTTON) return "pan"
  if (button !== PRIMARY_BUTTON) return "none"
  if (spaceHeld || tool === "hand") return "pan"
  const created = createdKind(tool)
  if (created !== undefined) return isDrawnKind(created) ? "draw" : "text"
  if (tool === "eraser") return "erase"
  if (tool === "selection") return selectionAction(onElement, onHandle)
  return "none"
}

export function panScroll(startScroll: Point, startPointer: Point, pointer: Point): Point {
  return {
    x: startScroll.x - (pointer.x - startPointer.x),
    y: startScroll.y - (pointer.y - startPointer.y),
  }
}
