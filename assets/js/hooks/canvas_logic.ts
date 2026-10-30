import { TEXT_WHITESPACE } from "../generated/manifest.ts"

export const PREVIEW_INTERVAL_MS = 50
export const MIN_SIZE = 1
export const DRAG_THRESHOLD = 3
export const STROKE_MIN_DISTANCE = 4

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Box extends Point, Size {}

export interface Shape {
  box: Box
  points: readonly Point[]
}

export type Endpoint = "start" | "end"

export const ENDPOINTS: readonly Endpoint[] = ["start", "end"]

export type Corner = "nw" | "ne" | "sw" | "se"

export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"]

export interface DragRef {
  element_id: string
  drag_id: string
}

export interface Preview extends DragRef, Box {
  seq: number
  base_version: number
  points: readonly Point[]
  text?: string
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

export function isDrag(start: Point, end: Point, zoom = 1): boolean {
  const threshold = DRAG_THRESHOLD / zoom
  return Math.abs(end.x - start.x) >= threshold || Math.abs(end.y - start.y) >= threshold
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

export function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function samePoint(a: Point, b: Point | undefined): boolean {
  return a.x === b?.x && a.y === b.y
}

export function sameShape(a: Shape, b: Shape): boolean {
  return (
    sameBox(a.box, b.box) &&
    a.points.length === b.points.length &&
    a.points.every((point, index) => samePoint(point, b.points[index]))
  )
}

export function absolutePoints({ box, points }: Shape): Point[] {
  return points.map(({ x, y }) => ({ x: box.x + x, y: box.y + y }))
}

export function shapeAround(points: readonly Point[], canvas: Size): Shape {
  const clamped = points.map((point) => clampToCanvas(point, canvas))
  const xs = clamped.map(({ x }) => x)
  const ys = clamped.map(({ y }) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
    points: clamped.map((point) => ({ x: point.x - x, y: point.y - y })),
  }
}

export function endpointPoint(shape: Shape, endpoint: Endpoint): Point | undefined {
  return absolutePoints(shape)[ENDPOINTS.indexOf(endpoint)]
}

export function movedEndpoint(shape: Shape, endpoint: Endpoint, pointer: Point, canvas: Size): Shape {
  const moved = ENDPOINTS.indexOf(endpoint)
  return shapeAround(
    absolutePoints(shape).map((point, index) => (index === moved ? pointer : point)),
    canvas,
  )
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function thinBy(points: readonly Point[], minDistance: number): Point[] {
  const [first, ...rest] = points
  if (first === undefined) return []
  const last = rest.pop()
  const kept = [first]
  for (const point of rest) {
    const previous = kept[kept.length - 1]
    if (previous !== undefined && distance(previous, point) >= minDistance) kept.push(point)
  }
  return last === undefined ? kept : [...kept, last]
}

export function thinStroke(points: readonly Point[], minDistance: number, max: number): Point[] {
  let spacing = minDistance
  let thinned = thinBy(points, spacing)
  while (thinned.length > Math.max(max, 2)) {
    spacing *= 2
    thinned = thinBy(points, spacing)
  }
  return thinned
}

export function scalePoints(points: readonly Point[], from: Size, to: Size): Point[] {
  const scale = (value: number, fromLength: number, toLength: number): number =>
    fromLength === 0 ? 0 : Math.round((value * toLength) / fromLength)
  return points.map(({ x, y }) => ({
    x: scale(x, from.width, to.width),
    y: scale(y, from.height, to.height),
  }))
}

export function previewDelay(
  lastSentAt: number,
  now: number,
  alreadyScheduled: boolean,
): number | undefined {
  if (alreadyScheduled) return undefined
  return Math.max(0, lastSentAt + PREVIEW_INTERVAL_MS - now)
}

function dragKey({ element_id, drag_id }: DragRef): string {
  return JSON.stringify([element_id, drag_id])
}

export class RemotePreviews {
  private latestSeq = new Map<string, number>()
  private finishedDrags = new Set<string>()
  private activeDrags = new Map<string, string>()
  private erasedIds = new Set<string>()

  accept(preview: DragRef & { seq: number; base_version: number }, knownVersion: number): boolean {
    const key = dragKey(preview)
    if (this.erasedIds.has(preview.element_id)) return false
    if (this.finishedDrags.has(key)) return false
    if (preview.base_version < knownVersion) return false
    const latest = this.latestSeq.get(key)
    if (latest !== undefined && preview.seq <= latest) return false

    this.latestSeq.set(key, preview.seq)
    this.activeDrags.set(preview.element_id, preview.drag_id)
    return true
  }

  finish(ref: DragRef): boolean {
    const key = dragKey(ref)
    this.finishedDrags.add(key)
    this.latestSeq.delete(key)
    if (this.activeDrags.get(ref.element_id) !== ref.drag_id) return false
    this.activeDrags.delete(ref.element_id)
    return true
  }

  forget(elementId: string): void {
    this.activeDrags.delete(elementId)
  }

  erase(elementId: string): void {
    this.erasedIds.add(elementId)
    this.forget(elementId)
  }
}

export interface Hittable {
  id: string
  box: Box
}

function clipped(range: { enter: number; exit: number }, delta: number, offset: number): boolean {
  if (delta === 0) return offset >= 0
  const t = offset / delta
  if (delta < 0) range.enter = Math.max(range.enter, t)
  else range.exit = Math.min(range.exit, t)
  return range.enter <= range.exit
}

export function segmentHitsBox(from: Point, to: Point, box: Box): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const range = { enter: 0, exit: 1 }
  return (
    clipped(range, -dx, from.x - box.x) &&
    clipped(range, dx, box.x + box.width - from.x) &&
    clipped(range, -dy, from.y - box.y) &&
    clipped(range, dy, box.y + box.height - from.y)
  )
}

function pathSegments(path: readonly Point[]): [Point, Point][] {
  const [first] = path
  if (first === undefined) return []
  if (path.length === 1) return [[first, first]]
  return path.slice(1).map((point, index) => [path[index] ?? point, point])
}

export function eraserHits(elements: readonly Hittable[], path: readonly Point[]): string[] {
  const segments = pathSegments(path)
  return elements
    .filter(({ box }) => segments.some(([from, to]) => segmentHitsBox(from, to, box)))
    .map(({ id }) => id)
}

export function textLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n")
}

const WORD_BREAKS: ReadonlySet<string> = new Set(TEXT_WHITESPACE)

export function isBlankText(text: string): boolean {
  return Array.from(text).every((character) => WORD_BREAKS.has(character))
}

function words(paragraph: string): string[] {
  const found: string[] = []
  let word = ""
  for (const character of paragraph) {
    if (!WORD_BREAKS.has(character)) {
      word += character
      continue
    }
    if (word !== "") found.push(word)
    word = ""
  }
  if (word !== "") found.push(word)
  return found
}

export function textBox(origin: Point, text: string, measure: (line: string) => number, lineHeight: number, canvas: Size): Box {
  const lines = textLines(text)
  const longest = Math.max(0, ...lines.map(measure))
  return clickBox(origin, { width: Math.max(MIN_SIZE, Math.ceil(longest)), height: lines.length * lineHeight }, canvas)
}

function charsPerLine(maxWidth: number, charWidth: number): number {
  let chars = Math.floor(maxWidth / charWidth)
  while (chars > 1 && chars * charWidth > maxWidth) chars -= 1
  return Math.max(1, chars)
}

function characterChunks(word: string, size: number): string[] {
  const characters = Array.from(word)
  const chunks: string[] = []
  for (let start = 0; start < characters.length; start += size) {
    chunks.push(characters.slice(start, start + size).join(""))
  }
  return chunks
}

function wrapParagraph(paragraph: string, chars: number): string[] {
  const lines: string[] = []
  let current = ""
  for (const word of words(paragraph)) {
    const joined = current === "" ? word : `${current} ${word}`
    if (Array.from(joined).length <= chars) {
      current = joined
      continue
    }
    if (current !== "") lines.push(current)
    const chunks = characterChunks(word, chars)
    current = chunks.pop() ?? ""
    lines.push(...chunks)
  }
  lines.push(current)
  return lines
}

export function wrapText(text: string, maxWidth: number, charWidth: number): string[] {
  const chars = charsPerLine(maxWidth, charWidth)
  return textLines(text).flatMap((paragraph) => wrapParagraph(paragraph, chars))
}
