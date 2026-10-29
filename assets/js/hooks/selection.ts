import {
  CORNERS,
  ENDPOINTS,
  absolutePoints,
  cornerPoint,
  textLines,
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

type ShapeTag = "rect" | "polygon" | "ellipse" | "line" | "polyline" | "text" | "tspan"

export interface TextLayout {
  fontSize: number
  lineHeight: number
  baseline: number
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

export function setShape(shape: Element, box: Box, points: readonly Point[]): void {
  setBox(shape, box)
  const absolute = absolutePoints({ box, points })
  setSegments(shape, absolute)
  setPolylines(shape, absolute)
  setTextBox(shape, box)
}

function textBody(shape: Element): Element | null {
  return shape.localName === "text" ? shape : shape.querySelector(TEXT_BODY)
}

function setTextBox(shape: Element, box: Box): void {
  textBody(shape)?.setAttribute("transform", `translate(${String(box.x)} ${String(box.y)})`)
  const hit = shape.querySelector(TEXT_HIT)
  if (hit !== null) setBox(hit, box)
}

export function setText(shape: Element, text: string, { fontSize, lineHeight, baseline }: TextLayout): void {
  const body = textBody(shape)
  if (body === null) return
  body.setAttribute("font-size", String(fontSize))
  body.replaceChildren(...textLines(text).map((line, index) => textLine(line, baseline + index * lineHeight)))
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

export class DrawLayer {
  constructor(private readonly layer: Element) {}

  shape(id: string, kind: PreviewKind): SVGElement {
    const existing = this.find(id)
    if (existing !== null) return existing
    const shape = svgShape(PREVIEW_TAGS[kind], {
      "data-draw": id,
      class: kind === "text" ? "draw-preview text-element" : "draw-preview",
    })
    if (kind === "arrow") shape.setAttribute("marker-end", "url(#arrowhead)")
    this.layer.append(shape)
    return shape
  }

  remove(id: string): void {
    this.find(id)?.remove()
  }

  private find(id: string): SVGElement | null {
    return this.layer.querySelector<SVGElement>(`[data-draw="${CSS.escape(id)}"]`)
  }
}
