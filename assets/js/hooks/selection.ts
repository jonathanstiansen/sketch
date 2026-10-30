import {
  CORNERS,
  ENDPOINTS,
  absolutePoints,
  cornerPoint,
  groupBox,
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
    class: `selection-handle selection-handle-${name}`,
  })
}

function placeHandle(rect: SVGRectElement, { x, y }: Point, size: number): void {
  rect.setAttribute("x", String(x - size / 2))
  rect.setAttribute("y", String(y - size / 2))
  rect.setAttribute("width", String(size))
  rect.setAttribute("height", String(size))
}

type Shown =
  | { mode: "single"; box: Box; points: readonly Point[]; handles: SelectionHandles }
  | { mode: "group"; boxes: readonly Box[] }

function outlineBox(box: Box, gap: number): Box {
  return { x: box.x - gap, y: box.y - gap, width: box.width + 2 * gap, height: box.height + 2 * gap }
}

export class SelectionOverlay {
  private readonly outline: SVGRectElement
  private readonly corners: Map<Corner, SVGRectElement>
  private readonly endpoints: Map<Endpoint, SVGRectElement>
  private zoom = 1
  private shown: Shown | undefined

  constructor(private readonly layer: Element) {
    this.outline = svgRect({ "data-selection-outline": "", class: "selection-outline" })
    this.corners = new Map(CORNERS.map((corner) => [corner, handle(corner)]))
    this.endpoints = new Map(ENDPOINTS.map((endpoint) => [endpoint, handle(endpoint)]))
  }

  setZoom(zoom: number): void {
    this.zoom = zoom
    const shown = this.shown
    if (shown?.mode === "single") this.show(shown.box, shown.points, shown.handles)
    if (shown?.mode === "group") this.showGroup(shown.boxes)
  }

  show(box: Box, points: readonly Point[], handles: SelectionHandles): void {
    this.shown = { mode: "single", box, points, handles }
    if (handles === "endpoints" && points.length > 0) {
      this.showEndpoints(box, points)
    } else {
      this.showBox(box, handles === "corners" ? [...this.corners.values()] : [])
    }
  }

  private showBox(box: Box, handles: SVGRectElement[]): void {
    setBox(this.outline, outlineBox(box, this.gap()))
    for (const [corner, rect] of this.corners) placeHandle(rect, cornerPoint(box, corner), this.handleSize())
    if (this.outline.parentNode !== this.layer || this.layer.childElementCount !== handles.length + 1) {
      this.layer.replaceChildren(this.outline, ...handles)
    }
  }

  private showEndpoints(box: Box, points: readonly Point[]): void {
    const absolute = absolutePoints({ box, points })
    ENDPOINTS.forEach((endpoint, index) => {
      const rect = this.endpoints.get(endpoint)
      const at = absolute[index]
      if (rect !== undefined && at !== undefined) placeHandle(rect, at, this.handleSize())
    })
    const [first] = this.endpoints.values()
    if (first?.parentNode !== this.layer) this.layer.replaceChildren(...this.endpoints.values())
  }

  showGroup(boxes: readonly Box[]): void {
    this.shown = { mode: "group", boxes }
    const bounds = groupBox(boxes)
    if (bounds === undefined) {
      this.hide()
      return
    }
    const members = boxes.map((box) => {
      const outline = svgRect({ "data-selection-member": "", class: "selection-outline" })
      setBox(outline, outlineBox(box, this.gap()))
      return outline
    })
    const group = svgRect({ "data-selection-group": "", class: "selection-group-outline" })
    setBox(group, outlineBox(bounds, 2 * this.gap()))
    this.layer.replaceChildren(group, ...members)
  }

  private gap(): number {
    return OUTLINE_GAP / this.zoom
  }

  private handleSize(): number {
    return HANDLE_SIZE / this.zoom
  }

  hide(): void {
    this.shown = undefined
    this.layer.replaceChildren()
  }
}

export class MarqueeLayer {
  private readonly marquee = svgRect({ "data-marquee": "", class: "selection-marquee" })

  constructor(private readonly layer: Element) {}

  show(box: Box): void {
    setBox(this.marquee, box)
    if (this.marquee.parentNode !== this.layer) this.layer.replaceChildren(this.marquee)
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
