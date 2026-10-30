import {
  CORNERS,
  ENDPOINTS,
  absolutePoints,
  cornerPoint,
  type Box,
  type Corner,
  type Endpoint,
  type Point,
} from "./canvas_logic"
import type { PreviewKind, SelectionHandles } from "./tools"
import { rendererFor } from "../elements"
import { SEED, renderElement, styleAttributes } from "../elements/dom"
import type { ElementStyle } from "../elements/style"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 10
const OUTLINE_GAP = 4

type ShapeTag = "rect" | "g"

function svgShape<K extends ShapeTag>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const shape = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value)
  return shape
}

function svgRect(attributes: Record<string, string>): SVGRectElement {
  return svgShape("rect", attributes)
}

function setBox(shape: Element, box: Box): void {
  const { x, y, width, height } = box
  shape.setAttribute("x", String(x))
  shape.setAttribute("y", String(y))
  shape.setAttribute("width", String(width))
  shape.setAttribute("height", String(height))
}

export function setShape(shape: Element, box: Box, points: readonly Point[], text: string | undefined): void {
  const renderer = rendererFor(shape.getAttribute("data-kind"))
  if (renderer === undefined) throw new Error("the shape has no known data-kind")
  renderElement(shape, renderer, box, points, text ?? shape.getAttribute("data-text") ?? "")
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

function localPreview(id: string, kind: PreviewKind, seed: number, style: ElementStyle): SVGGElement {
  return svgShape("g", {
    "data-draw": id,
    "data-kind": kind,
    [SEED]: String(seed),
    ...styleAttributes(style),
    class: "local-preview",
  })
}

export class DrawLayer {
  constructor(private readonly layer: Element) {}

  shape(id: string, kind: PreviewKind, seed: number, style: ElementStyle): SVGElement {
    const existing = this.find(id)
    if (existing !== null) return existing
    const shape = localPreview(id, kind, seed, style)
    this.layer.append(shape)
    return shape
  }

  remove(id: string): void {
    this.find(id)?.remove()
  }

  hideText(id: string): void {
    this.find(id)?.setAttribute("data-text-editing", "")
  }

  private find(id: string): SVGElement | null {
    return this.layer.querySelector<SVGElement>(`[data-draw="${CSS.escape(id)}"]`)
  }
}
