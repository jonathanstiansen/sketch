import {
  CORNERS,
  ENDPOINTS,
  absolutePoints,
  cornerPoint,
  wrapText,
  type Box,
  type Corner,
  type Endpoint,
  type Point,
} from "./canvas_logic"
import type { PreviewKind, SelectionHandles } from "./tools"
import { isMigratedKind, rendererFor } from "../elements"
import { renderElement, setLivePoints } from "../elements/dom"
import type { MigratedKind } from "../generated/manifest"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 10
const OUTLINE_GAP = 4
const NOTE_PARTS = "rect[data-note-body], svg[data-note-clip]"
const NOTE_TEXT = "data-note-text"
const NOTE_SOURCE = "data-source"

type ShapeTag = "rect" | "text" | "tspan" | "g" | "svg"

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

export function setBox(shape: Element, box: Box): void {
  const { x, y, width, height } = box
  shape.setAttribute("x", String(x))
  shape.setAttribute("y", String(y))
  shape.setAttribute("width", String(width))
  shape.setAttribute("height", String(height))
}

export function setShape(shape: Element, box: Box, points: readonly Point[], text: string | undefined, layout: TextLayout): void {
  const renderer = rendererFor(shape.getAttribute("data-kind"))
  if (renderer !== undefined) {
    renderElement(shape, renderer, box, points, text ?? shape.getAttribute("data-text") ?? "")
    return
  }
  setBox(shape, box)
  setLivePoints(shape, points)
  for (const part of shape.querySelectorAll(NOTE_PARTS)) setBox(part, box)
  const note = noteText(shape)
  if (note !== null) setNoteText(shape, note, text ?? note.getAttribute(NOTE_SOURCE) ?? shape.getAttribute("data-text") ?? "", layout)
}

function noteText(shape: Element): Element | null {
  return shape.querySelector(`text[${NOTE_TEXT}]`)
}

function setNoteText(note: Element, body: Element, text: string, layout: TextLayout): void {
  const { fontSize, lineHeight, baseline, charWidth, notePadding } = layout
  const lines = wrapText(text, Number(note.getAttribute("width")) - 2 * notePadding, charWidth)
  body.setAttribute("font-size", String(fontSize))
  body.setAttribute(NOTE_SOURCE, text)
  body.replaceChildren(...lines.map((line, index) => textLine(line, baseline + index * lineHeight)))
}

export function layoutKey(shape: Element): string {
  return `${shape.getAttribute("width") ?? ""}:${shape.getAttribute("data-text") ?? ""}`
}

export function layoutCommittedNote(note: Element, layout: TextLayout): void {
  const body = noteText(note)
  const key = layoutKey(note)
  if (body === null || body.getAttribute("data-laid-out") === key) return
  setNoteText(note, body, note.getAttribute("data-text") ?? "", layout)
  body.setAttribute("data-laid-out", key)
}

function textLine(line: string, y: number): SVGTSpanElement {
  const span = svgShape("tspan", { x: "0", y: String(y) })
  span.textContent = line
  return span
}

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

function localPreview(id: string, kind: MigratedKind): SVGGElement {
  return svgShape("g", { "data-draw": id, "data-kind": kind, class: "local-preview" })
}

export class DrawLayer {
  constructor(private readonly layer: Element) {}

  shape(id: string, kind: PreviewKind): SVGElement {
    const existing = this.find(id)
    if (existing !== null) return existing
    const shape = this.newShape(id, kind)
    this.layer.append(shape)
    return shape
  }

  remove(id: string): void {
    this.find(id)?.remove()
  }

  hideText(id: string): void {
    this.find(id)?.setAttribute("data-text-editing", "")
  }

  private newShape(id: string, kind: PreviewKind): SVGElement {
    return isMigratedKind(kind) ? localPreview(id, kind) : noteGroup(id)
  }

  private find(id: string): SVGElement | null {
    return this.layer.querySelector<SVGElement>(`[data-draw="${CSS.escape(id)}"]`)
  }
}
