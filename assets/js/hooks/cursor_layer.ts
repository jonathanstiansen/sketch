import { STYLE_TOKENS } from "../generated/manifest.ts"
import type { RemoteCursor } from "./cursor_logic.ts"

const SVG_NS = "http://www.w3.org/2000/svg"
const ARROW_PATH = "M0 0L0 17L4.5 13L7.5 20L10 19L7 12L13 12Z"
const NAME_CHAR_WIDTH = 7
const TAG_PADDING = 10
const TAG_HEIGHT = 18
const TAG_OFFSET = { x: 12, y: 20 }

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, className: string): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag)
  element.setAttribute("class", className)
  return element
}

function isColorToken(color: string): boolean {
  const tokens: readonly string[] = STYLE_TOKENS.stroke_color
  return tokens.includes(color)
}

function colorClass(color: string): string {
  return `cursor-color-${isColorToken(color) ? color : STYLE_TOKENS.stroke_color[0]}`
}

export class CursorLayer {
  constructor(private readonly layer: Element) {}

  show(cursor: RemoteCursor): void {
    const group = this.find(cursor.viewer_id) ?? this.create(cursor)
    group.setAttribute("transform", `translate(${String(cursor.x)} ${String(cursor.y)})`)
  }

  remove(viewerId: string): void {
    this.find(viewerId)?.remove()
  }

  private create({ viewer_id, name, color }: RemoteCursor): SVGGElement {
    const group = svgElement("g", `remote-cursor ${colorClass(color)}`)
    group.setAttribute("data-cursor", viewer_id)
    group.setAttribute("data-name", name)

    const tag = svgElement("rect", "remote-cursor-tag")
    tag.setAttribute("x", String(TAG_OFFSET.x))
    tag.setAttribute("y", String(TAG_OFFSET.y))
    tag.setAttribute("width", String(name.length * NAME_CHAR_WIDTH + TAG_PADDING * 2))
    tag.setAttribute("height", String(TAG_HEIGHT))
    tag.setAttribute("rx", "4")

    const label = svgElement("text", "remote-cursor-name")
    label.setAttribute("x", String(TAG_OFFSET.x + TAG_PADDING))
    label.setAttribute("y", String(TAG_OFFSET.y + 13))
    label.textContent = name

    const arrow = svgElement("path", "remote-cursor-arrow")
    arrow.setAttribute("d", ARROW_PATH)

    group.append(arrow, tag, label)
    this.layer.append(group)
    return group
  }

  private find(viewerId: string): SVGGElement | null {
    return this.layer.querySelector<SVGGElement>(`[data-cursor="${CSS.escape(viewerId)}"]`)
  }
}
