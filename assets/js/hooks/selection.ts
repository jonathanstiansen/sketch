import { CORNERS, cornerPoint, type Box, type Corner } from "./canvas_logic"

const SVG_NS = "http://www.w3.org/2000/svg"
const HANDLE_SIZE = 10
const OUTLINE_GAP = 4

function svgRect(attributes: Record<string, string>): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, "rect")
  for (const [name, value] of Object.entries(attributes)) rect.setAttribute(name, value)
  return rect
}

export function setBox(rect: Element, { x, y, width, height }: Box): void {
  rect.setAttribute("x", String(x))
  rect.setAttribute("y", String(y))
  rect.setAttribute("width", String(width))
  rect.setAttribute("height", String(height))
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

  shape(id: string): SVGRectElement {
    const existing = this.find(id)
    if (existing !== null) return existing
    const shape = svgRect({ "data-draw": id, class: "draw-preview" })
    this.layer.append(shape)
    return shape
  }

  remove(id: string): void {
    this.find(id)?.remove()
  }

  private find(id: string): SVGRectElement | null {
    return this.layer.querySelector<SVGRectElement>(`rect[data-draw="${CSS.escape(id)}"]`)
  }
}
