export const PREVIEW_INTERVAL_MS = 50
export const MIN_SIZE = 1
export const DRAG_THRESHOLD = 3

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Box extends Point, Size {}

export type Corner = "nw" | "ne" | "sw" | "se"

export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"]

export interface DragRef {
  element_id: string
  drag_id: string
}

export interface Preview extends DragRef, Box {
  seq: number
  base_version: number
}

export function clamp(value: number, max: number): number {
  return Math.min(Math.max(Math.round(value), 0), max)
}

export function dragPosition(cursor: Point, grab: Point, max: Point): Point {
  return { x: clamp(cursor.x - grab.x, max.x), y: clamp(cursor.y - grab.y, max.y) }
}

export function movedBox(box: Box, cursor: Point, grab: Point, canvas: Size): Box {
  const max = { x: canvas.width - box.width, y: canvas.height - box.height }
  return { ...box, ...dragPosition(cursor, grab, max) }
}

function clampToCanvas(point: Point, canvas: Size): Point {
  return { x: clamp(point.x, canvas.width), y: clamp(point.y, canvas.height) }
}

function span(a: number, b: number, limit: number): { start: number; length: number } {
  const length = Math.max(Math.abs(b - a), MIN_SIZE)
  return { start: Math.min(a, b, limit - length), length }
}

export function drawnBox(start: Point, end: Point, canvas: Size): Box {
  const a = clampToCanvas(start, canvas)
  const b = clampToCanvas(end, canvas)
  const horizontal = span(a.x, b.x, canvas.width)
  const vertical = span(a.y, b.y, canvas.height)
  return { x: horizontal.start, y: vertical.start, width: horizontal.length, height: vertical.length }
}

export function clickBox(point: Point, size: Size, canvas: Size): Box {
  const width = Math.min(size.width, canvas.width)
  const height = Math.min(size.height, canvas.height)
  return {
    x: clamp(point.x, canvas.width - width),
    y: clamp(point.y, canvas.height - height),
    width,
    height,
  }
}

export function isDrag(start: Point, end: Point): boolean {
  return Math.abs(end.x - start.x) >= DRAG_THRESHOLD || Math.abs(end.y - start.y) >= DRAG_THRESHOLD
}

export function cornerPoint(box: Box, corner: Corner): Point {
  return {
    x: corner.endsWith("e") ? box.x + box.width : box.x,
    y: corner.startsWith("s") ? box.y + box.height : box.y,
  }
}

const OPPOSITE: Record<Corner, Corner> = { nw: "se", ne: "sw", sw: "ne", se: "nw" }

export function resizedBox(box: Box, corner: Corner, pointer: Point, canvas: Size): Box {
  return drawnBox(cornerPoint(box, OPPOSITE[corner]), pointer, canvas)
}

export function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function previewDelay(
  lastSentAt: number,
  now: number,
  alreadyScheduled: boolean,
): number | undefined {
  if (alreadyScheduled) return undefined
  return Math.max(0, lastSentAt + PREVIEW_INTERVAL_MS - now)
}

export class RemotePreviews {
  private latestSeq = new Map<string, number>()
  private finishedDragIds = new Set<string>()
  private activeDrags = new Map<string, string>()

  accept(preview: DragRef & { seq: number; base_version: number }, knownVersion: number): boolean {
    if (this.finishedDragIds.has(preview.drag_id)) return false
    if (preview.base_version < knownVersion) return false
    const latest = this.latestSeq.get(preview.drag_id)
    if (latest !== undefined && preview.seq <= latest) return false

    this.latestSeq.set(preview.drag_id, preview.seq)
    this.activeDrags.set(preview.element_id, preview.drag_id)
    return true
  }

  finish({ element_id, drag_id }: DragRef): boolean {
    this.finishedDragIds.add(drag_id)
    this.latestSeq.delete(drag_id)
    if (this.activeDrags.get(element_id) !== drag_id) return false
    this.activeDrags.delete(element_id)
    return true
  }

  forget(elementId: string): void {
    this.activeDrags.delete(elementId)
  }
}
