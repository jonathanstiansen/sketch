import { ENDPOINTS, type Point, type Size } from "./canvas_logic.ts"
import {
  DEFAULT_TOOL,
  ELEMENT_KINDS,
  KIND_SPECS,
  POINTER_GESTURES,
  REQUIRED_TEXT_KINDS,
  TEXT_KINDS,
  TOOLS as TOOL_SPECS,
  TYPED_KINDS,
  type ElementKind,
  type KindSpec,
  type PointerGestureSpec,
  type RequiredTextKind,
  type TextKind,
  type ToolId,
  type TypedKind,
} from "../generated/manifest.ts"
import { focusContext, shortcutFor, type Shortcut, type ShortcutInput } from "./shortcuts.ts"

export { DEFAULT_TOOL, type ToolId }

export interface Tool {
  id: ToolId
  enabled: boolean
}

export const TOOLS: readonly Tool[] = TOOL_SPECS.map(({ id, enabled }) => ({ id, enabled }))

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

export interface KeyInput extends ShortcutInput {
  readonly editable: boolean
}

export type PointerAction = (typeof POINTER_GESTURES)[number]["action"] | "none"

export interface PointerInput {
  button: number
  tool: ToolId
  spaceHeld: boolean
  onElement: boolean
  onHandle: boolean
  altKey?: boolean
  shiftKey?: boolean
}

interface GestureInput {
  button: PointerGestureSpec["button"]
  tool: ToolId
  target: NonNullable<PointerGestureSpec["target"]>
  space: boolean
  shift: boolean
  alt: boolean
  command: boolean
}

const PRESS_BUTTONS: readonly PointerGestureSpec["button"][] = ["primary", "middle"]

function allows<T>(declared: T | null, actual: T): boolean {
  return declared === null || declared === actual
}

export function gestureMatches(gesture: PointerGestureSpec, input: GestureInput): boolean {
  return (
    gesture.button === input.button &&
    gesture.tools.includes(input.tool) &&
    allows(gesture.target, input.target) &&
    allows(gesture.space, input.space) &&
    allows(gesture.shift, input.shift) &&
    allows(gesture.alt, input.alt) &&
    (gesture.mod === null || input.command)
  )
}

function gestureAction(input: GestureInput): PointerAction {
  return POINTER_GESTURES.find((gesture) => gestureMatches(gesture, input))?.action ?? "none"
}

function keyShortcut(input: KeyInput): Shortcut | undefined {
  return shortcutFor(input, focusContext(input.editable))
}

export function selectTool(current: ToolId, requested: string): ToolId {
  const tool = TOOLS.find(({ id }) => id === requested)
  return tool?.enabled === true ? tool.id : current
}

export function nextTool(current: ToolId, input: KeyInput): ToolId {
  const shortcut = keyShortcut(input)
  if (shortcut?.group === "tool") return selectTool(current, shortcut.action)
  return shortcut?.action === "escape" ? DEFAULT_TOOL : current
}

export function togglesHelp(input: KeyInput): boolean {
  return keyShortcut(input)?.action === "help"
}

export function deletesSelection(input: KeyInput): boolean {
  return keyShortcut(input)?.action === "delete"
}

export function isPanKey(input: KeyInput): boolean {
  return keyShortcut(input)?.action === "pan"
}

export function escapes(input: KeyInput): boolean {
  return keyShortcut(input)?.action === "escape"
}

function pressTarget(onElement: boolean, onHandle: boolean): GestureInput["target"] {
  if (onHandle) return "handle"
  return onElement ? "element" : "empty"
}

export function pointerAction({ button, tool, spaceHeld, onElement, onHandle, altKey = false, shiftKey = false }: PointerInput): PointerAction {
  const pressed = PRESS_BUTTONS[button]
  if (pressed === undefined) return "none"
  return gestureAction({
    button: pressed,
    tool,
    target: pressTarget(onElement, onHandle),
    space: spaceHeld,
    shift: shiftKey,
    alt: altKey,
    command: false,
  })
}

export interface WheelInput {
  tool: ToolId
  ctrlKey: boolean
  metaKey: boolean
}

export function wheelAction({ tool, ctrlKey, metaKey }: WheelInput): PointerAction {
  return gestureAction({
    button: "wheel",
    tool,
    target: "empty",
    space: false,
    shift: false,
    alt: false,
    command: ctrlKey || metaKey,
  })
}

export function keepsSelection(tool: ToolId): boolean {
  return tool === "selection" || tool === "eraser"
}

export function panScroll(startScroll: Point, startPointer: Point, pointer: Point): Point {
  return {
    x: startScroll.x - (pointer.x - startPointer.x),
    y: startScroll.y - (pointer.y - startPointer.y),
  }
}
