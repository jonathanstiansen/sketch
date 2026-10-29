import { CORNERS, cornerPoint, type Box, type Corner } from "./canvas_logic"
import type { DrawnKind } from "./tools"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 10
const OUTLINE_GAP = 4

function svgShape<K extends "rect" | "polygon">(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
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
}

export function isCorner(value: string | undefined): value is Corner {
  return CORNERS.some((corner) => corner === value)
}

export class SelectionOverlay {
  private readonly outline: SVGRectElement
  private readonly handles: Map<Corner, SVGRectElement>

  constructor(private readonly layer: Element) {
    this.outline = svgRect({ "data-selection-outline": "", class: "selection-outline" })
    this.handles = new Map(
      CORNERS.map((corner) => [
        corner,
        svgRect({
          "data-handle": corner,
          width: String(HANDLE_SIZE),
          height: String(HANDLE_SIZE),
          class: `selection-handle selection-handle-${corner}`,
        }),
      ]),
    )
  }

  show(box: Box): void {
    setBox(this.outline, {
      x: box.x - OUTLINE_GAP,
      y: box.y - OUTLINE_GAP,
      width: box.width + 2 * OUTLINE_GAP,
      height: box.height + 2 * OUTLINE_GAP,
    })
    for (const [corner, handle] of this.handles) {
      const { x, y } = cornerPoint(box, corner)
      handle.setAttribute("x", String(x - HANDLE_SIZE / 2))
      handle.setAttribute("y", String(y - HANDLE_SIZE / 2))
    }
    if (this.outline.parentNode !== this.layer) this.layer.replaceChildren(this.outline, ...this.handles.values())
  }

  hide(): void {
    this.layer.replaceChildren()
  }
}

export class DrawLayer {
  constructor(private readonly layer: Element) {}

  shape(id: string, kind: DrawnKind): SVGElement {
    const existing = this.find(id)
    if (existing !== null) return existing
    const shape = svgShape(kind === "diamond" ? "polygon" : "rect", {
      "data-draw": id,
      class: "draw-preview",
    })
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
