import type { Point } from "./canvas_logic"

export type ToolId =
  | "hand"
  | "selection"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "draw"
  | "text"
  | "note"
  | "eraser"

export interface Tool {
  id: ToolId
  letter: string
  digit: string | null
  enabled: boolean
}

export const TOOLS: readonly Tool[] = [
  { id: "hand", letter: "h", digit: null, enabled: true },
  { id: "selection", letter: "v", digit: "1", enabled: true },
  { id: "rectangle", letter: "r", digit: "2", enabled: true },
  { id: "diamond", letter: "d", digit: "3", enabled: true },
  { id: "ellipse", letter: "o", digit: "4", enabled: false },
  { id: "arrow", letter: "a", digit: "5", enabled: false },
  { id: "line", letter: "l", digit: "6", enabled: false },
  { id: "draw", letter: "p", digit: "7", enabled: false },
  { id: "text", letter: "t", digit: "8", enabled: false },
  { id: "note", letter: "n", digit: "9", enabled: false },
  { id: "eraser", letter: "e", digit: "0", enabled: false },
]

export const DEFAULT_TOOL: ToolId = "selection"

export type DrawnKind = "rectangle" | "diamond"

export function drawnKind(tool: ToolId): DrawnKind | undefined {
  return tool === "rectangle" || tool === "diamond" ? tool : undefined
}

export interface KeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  editable: boolean
}

export type PointerAction = "pan" | "draw" | "move" | "resize" | "deselect" | "none"

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
  if (drawnKind(tool) !== undefined) return "draw"
  if (tool === "selection") return selectionAction(onElement, onHandle)
  return "none"
}

export function panScroll(startScroll: Point, startPointer: Point, pointer: Point): Point {
  return {
    x: startScroll.x - (pointer.x - startPointer.x),
    y: startScroll.y - (pointer.y - startPointer.y),
  }
}
