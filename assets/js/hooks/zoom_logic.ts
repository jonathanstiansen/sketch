import { ZOOM_ACTIONS, type ZoomActionId } from "../generated/manifest.ts"
import type { Box, Point, Size } from "./canvas_logic.ts"
import { focusContext, shortcutFor, type ShortcutInput } from "./shortcuts.ts"

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const DEFAULT_ZOOM = 1
export const ZOOM_LEVELS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
export const FIT_PADDING = 48
export const WHEEL_ZOOM_RATE = 0.01
export const WHEEL_DELTA_LIMIT = 25

const LEVEL_EPSILON = 1e-6

export type ZoomDirection = "in" | "out"

export interface View {
  zoom: number
  scroll: Point
}

export interface ZoomKeyInput extends ShortcutInput {
  readonly editable: boolean
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

export function stepZoom(zoom: number, direction: ZoomDirection): number {
  const levels = direction === "in" ? ZOOM_LEVELS.filter((level) => level > zoom + LEVEL_EPSILON) : ZOOM_LEVELS.filter((level) => level < zoom - LEVEL_EPSILON).reverse()
  return levels[0] ?? clampZoom(zoom)
}

export function wheelZoom(zoom: number, deltaY: number): number {
  const limited = Math.min(Math.max(deltaY, -WHEEL_DELTA_LIMIT), WHEEL_DELTA_LIMIT)
  return clampZoom(zoom * Math.exp(-limited * WHEEL_ZOOM_RATE))
}

export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100)
}

export function screenToCanvas(client: Point, origin: Point, zoom: number): Point {
  return { x: (client.x - origin.x) / zoom, y: (client.y - origin.y) / zoom }
}

export function canvasUnderAnchor(scroll: Point, anchor: Point, zoom: number): Point {
  return { x: (scroll.x + anchor.x) / zoom, y: (scroll.y + anchor.y) / zoom }
}

export function anchoredScroll(scroll: Point, anchor: Point, from: number, to: number): Point {
  const fixed = canvasUnderAnchor(scroll, anchor, from)
  return { x: fixed.x * to - anchor.x, y: fixed.y * to - anchor.y }
}

function clampAxis(value: number, content: number, viewport: number): number {
  return Math.min(Math.max(value, 0), Math.max(content - viewport, 0))
}

export function clampScroll(scroll: Point, canvas: Size, zoom: number, viewport: Size): Point {
  return {
    x: clampAxis(scroll.x, canvas.width * zoom, viewport.width),
    y: clampAxis(scroll.y, canvas.height * zoom, viewport.height),
  }
}

export function centeredOn(point: Point, canvas: Size, zoom: number, viewport: Size): Point {
  const centered = { x: point.x * zoom - viewport.width / 2, y: point.y * zoom - viewport.height / 2 }
  return clampScroll(centered, canvas, zoom, viewport)
}

export function visibleCanvas(view: View, viewport: Size): Box {
  return {
    x: view.scroll.x / view.zoom,
    y: view.scroll.y / view.zoom,
    width: viewport.width / view.zoom,
    height: viewport.height / view.zoom,
  }
}

function paddedBounds(boxes: readonly Box[], canvas: Size, padding: number): Box | undefined {
  if (boxes.length === 0) return undefined
  const left = Math.max(Math.min(...boxes.map(({ x }) => x)) - padding, 0)
  const top = Math.max(Math.min(...boxes.map(({ y }) => y)) - padding, 0)
  const right = Math.min(Math.max(...boxes.map(({ x, width }) => x + width)) + padding, canvas.width)
  const bottom = Math.min(Math.max(...boxes.map(({ y, height }) => y + height)) + padding, canvas.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function fitView(boxes: readonly Box[], canvas: Size, viewport: Size, padding = FIT_PADDING): View {
  const bounds = paddedBounds(boxes, canvas, padding)
  if (bounds === undefined) return { zoom: DEFAULT_ZOOM, scroll: { x: 0, y: 0 } }
  const zoom = clampZoom(Math.min(viewport.width / bounds.width, viewport.height / bounds.height))
  const centered = {
    x: (bounds.x + bounds.width / 2) * zoom - viewport.width / 2,
    y: (bounds.y + bounds.height / 2) * zoom - viewport.height / 2,
  }
  return { zoom, scroll: clampScroll(centered, canvas, zoom, viewport) }
}

export function zoomActionFor(input: ZoomKeyInput): ZoomActionId | undefined {
  const shortcut = shortcutFor(input, focusContext(input.editable))
  return shortcut?.group === "zoom" ? shortcut.action : undefined
}

export function isZoomAction(value: unknown): value is ZoomActionId {
  return ZOOM_ACTIONS.some(({ id }) => id === value)
}
