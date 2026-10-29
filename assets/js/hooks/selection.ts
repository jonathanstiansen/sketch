import {
  CORNERS,
  ENDPOINTS,
  absolutePoints,
  cornerPoint,
  textLines,
  wrapText,
  type Box,
  type Corner,
  type Endpoint,
  type Point,
} from "./canvas_logic"
import type { PreviewKind, SelectionHandles } from "./tools"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 10
const OUTLINE_GAP = 4
const LINE_SEGMENTS = "line[data-line-hit], line[data-line-stroke]"
const POLYLINES = "polyline[data-freedraw-hit], polyline[data-freedraw-stroke]"
const TEXT_BODY = "text[data-text-body]"
const TEXT_HIT = "rect[data-text-hit]"
const NOTE_PARTS = "rect[data-note-body], svg[data-note-clip]"
const NOTE_TEXT = "data-note-text"
const NOTE_SOURCE = "data-source"

type ShapeTag = "rect" | "polygon" | "ellipse" | "line" | "polyline" | "text" | "tspan" | "g" | "svg"

export interface TextLayout {
  fontSize: number
  lineHeight: number
  baseline: number
  charWidth: number
  notePadding: number
}

function svgShape<K extends ShapeTag>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const shape = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value)
  return shape
}

function svgRect(attributes: Record<string, string>): SVGRectElement {
  return svgShape("rect", attributes)
}

function point(x: number, y: number): string {
  return [x, y].map(String).join(",")
}

export function diamondPoints({ x, y, width, height }: Box): string {
  const midX = x + width / 2
  const midY = y + height / 2
  return [point(midX, y), point(x + width, midY), point(midX, y + height), point(x, midY)].join(" ")
}

export function setBox(shape: Element, box: Box): void {
  const { x, y, width, height } = box
  shape.setAttribute("x", String(x))
  shape.setAttribute("y", String(y))
  shape.setAttribute("width", String(width))
  shape.setAttribute("height", String(height))
  if (shape.localName === "polygon") shape.setAttribute("points", diamondPoints(box))
  if (shape.localName === "ellipse") setEllipse(shape, box)
}

export function setShape(shape: Element, box: Box, points: readonly Point[], layout: TextLayout): void {
  setBox(shape, box)
  const absolute = absolutePoints({ box, points })
  setSegments(shape, absolute)
  setPolylines(shape, absolute)
  setTextBox(shape, box)
  const note = noteText(shape)
  if (note !== null) setText(shape, note.getAttribute(NOTE_SOURCE) ?? shape.getAttribute("data-text") ?? "", layout)
}

function textBody(shape: Element): Element | null {
  return shape.localName === "text" ? shape : shape.querySelector(TEXT_BODY)
}

function noteText(shape: Element): Element | null {
  return shape.querySelector(`text[${NOTE_TEXT}]`)
}

function setTextBox(shape: Element, box: Box): void {
  const body = textBody(shape)
  if (body !== null && !body.hasAttribute(NOTE_TEXT)) {
    body.setAttribute("transform", `translate(${String(box.x)} ${String(box.y)})`)
  }
  const hit = shape.querySelector(TEXT_HIT)
  if (hit !== null) setBox(hit, box)
  for (const part of shape.querySelectorAll(NOTE_PARTS)) setBox(part, box)
}

function wrappedLines(shape: Element, body: Element, text: string, layout: TextLayout): string[] {
  if (!body.hasAttribute(NOTE_TEXT)) return textLines(text)
  const width = Number(shape.getAttribute("width")) - 2 * layout.notePadding
  return wrapText(text, width, layout.charWidth)
}

export function setText(shape: Element, text: string, layout: TextLayout): void {
  const body = textBody(shape)
  if (body === null) return
  const { fontSize, lineHeight, baseline } = layout
  body.setAttribute("font-size", String(fontSize))
  if (body.hasAttribute(NOTE_TEXT)) body.setAttribute(NOTE_SOURCE, text)
  body.replaceChildren(
    ...wrappedLines(shape, body, text, layout).map((line, index) => textLine(line, baseline + index * lineHeight)),
  )
}

export function layoutKey(shape: Element): string {
  return `${shape.getAttribute("width") ?? ""}:${shape.getAttribute("data-text") ?? ""}`
}

export function layoutCommittedNote(note: Element, layout: TextLayout): void {
  const body = noteText(note)
  const key = layoutKey(note)
  if (body === null || body.getAttribute("data-laid-out") === key) return
  setText(note, note.getAttribute("data-text") ?? "", layout)
  body.setAttribute("data-laid-out", key)
}

function textLine(line: string, y: number): SVGTSpanElement {
  const span = svgShape("tspan", { x: "0", y: String(y) })
  span.textContent = line
  return span
}

function setSegments(shape: Element, [start, end]: Point[]): void {
  if (start === undefined || end === undefined) return
  const segments = shape.localName === "line" ? [shape] : shape.querySelectorAll(LINE_SEGMENTS)
  for (const segment of segments) setSegment(segment, start, end)
}

function setPolylines(shape: Element, absolute: Point[]): void {
  const polylines = shape.localName === "polyline" ? [shape] : shape.querySelectorAll(POLYLINES)
  for (const polyline of polylines) polyline.setAttribute("points", absolute.map(({ x, y }) => point(x, y)).join(" "))
}

function setSegment(segment: Element, start: Point, end: Point): void {
  segment.setAttribute("x1", String(start.x))
  segment.setAttribute("y1", String(start.y))
  segment.setAttribute("x2", String(end.x))
  segment.setAttribute("y2", String(end.y))
}

function setEllipse(shape: Element, { x, y, width, height }: Box): void {
  shape.setAttribute("cx", String(x + width / 2))
  shape.setAttribute("cy", String(y + height / 2))
  shape.setAttribute("rx", String(width / 2))
  shape.setAttribute("ry", String(height / 2))
}

const PREVIEW_TAGS = {
  rectangle: "rect",
  diamond: "polygon",
  ellipse: "ellipse",
  arrow: "line",
  freedraw: "polyline",
  line: "line",
  text: "text",
} as const

export function isCorner(value: string | undefined): value is Corner {
  return CORNERS.some((corner) => corner === value)
}

export function isEndpoint(value: string | undefined): value is Endpoint {
  return ENDPOINTS.some((endpoint) => endpoint === value)
}

function handle(name: Corner | Endpoint): SVGRectElement {
  return svgRect({
    "data-handle": name,
    width: String(HANDLE_SIZE),
    height: String(HANDLE_SIZE),
    class: `selection-handle selection-handle-${name}`,
  })
}

function placeHandle(rect: SVGRectElement, { x, y }: Point): void {
  rect.setAttribute("x", String(x - HANDLE_SIZE / 2))
  rect.setAttribute("y", String(y - HANDLE_SIZE / 2))
}

export class SelectionOverlay {
  private readonly outline: SVGRectElement
  private readonly corners: Map<Corner, SVGRectElement>
  private readonly endpoints: Map<Endpoint, SVGRectElement>

  constructor(private readonly layer: Element) {
    this.outline = svgRect({ "data-selection-outline": "", class: "selection-outline" })
    this.corners = new Map(CORNERS.map((corner) => [corner, handle(corner)]))
    this.endpoints = new Map(ENDPOINTS.map((endpoint) => [endpoint, handle(endpoint)]))
  }

  show(box: Box, points: readonly Point[], handles: SelectionHandles): void {
    if (handles === "endpoints" && points.length > 0) {
      this.showEndpoints(box, points)
    } else {
      this.showBox(box, handles === "corners" ? [...this.corners.values()] : [])
    }
  }

  private showBox(box: Box, handles: SVGRectElement[]): void {
    setBox(this.outline, {
      x: box.x - OUTLINE_GAP,
      y: box.y - OUTLINE_GAP,
      width: box.width + 2 * OUTLINE_GAP,
      height: box.height + 2 * OUTLINE_GAP,
    })
    for (const [corner, rect] of this.corners) placeHandle(rect, cornerPoint(box, corner))
    if (this.outline.parentNode !== this.layer || this.layer.childElementCount !== handles.length + 1) {
      this.layer.replaceChildren(this.outline, ...handles)
    }
  }

  private showEndpoints(box: Box, points: readonly Point[]): void {
    const absolute = absolutePoints({ box, points })
    ENDPOINTS.forEach((endpoint, index) => {
      const rect = this.endpoints.get(endpoint)
      const at = absolute[index]
      if (rect !== undefined && at !== undefined) placeHandle(rect, at)
    })
    const [first] = this.endpoints.values()
    if (first?.parentNode !== this.layer) this.layer.replaceChildren(...this.endpoints.values())
  }

  hide(): void {
    this.layer.replaceChildren()
  }
}

function noteGroup(id: string): SVGGElement {
  const group = svgShape("g", { "data-draw": id, class: "draw-preview" })
  const clip = svgShape("svg", { "data-note-clip": "", overflow: "hidden" })
  clip.append(svgShape("text", { "data-text-body": "", [NOTE_TEXT]: "", class: "text-element" }))
  group.append(svgShape("rect", { "data-note-body": "", rx: "6", class: "note-body" }), clip)
  return group
}

export class DrawLayer {
  constructor(private readonly layer: Element) {}

  shape(id: string, kind: PreviewKind): SVGElement {
    const existing = this.find(id)
    if (existing !== null) return existing
    const shape = kind === "note" ? noteGroup(id) : this.previewShape(id, kind)
    if (kind === "arrow") shape.setAttribute("marker-end", "url(#arrowhead)")
    this.layer.append(shape)
    return shape
  }

  remove(id: string): void {
    this.find(id)?.remove()
  }

  hideText(id: string): void {
    this.find(id)?.setAttribute("data-text-editing", "")
  }

  private previewShape(id: string, kind: Exclude<PreviewKind, "note">): SVGElement {
    return svgShape(PREVIEW_TAGS[kind], {
      "data-draw": id,
      class: kind === "text" ? "draw-preview text-element" : "draw-preview",
    })
  }

  private find(id: string): SVGElement | null {
    return this.layer.querySelector<SVGElement>(`[data-draw="${CSS.escape(id)}"]`)
  }
}
