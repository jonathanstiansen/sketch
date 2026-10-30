import type { Box, Point } from "../hooks/canvas_logic.ts"
import { GEOMETRY } from "../generated/manifest.ts"
import { attributeString, type Renderer, type SvgNode } from "./renderer.ts"

const SVG_NS = "http://www.w3.org/2000/svg"
const LIVEVIEW_ATTRIBUTE_PREFIX = "data-phx-"
export const LIVE_POINTS = "live-points"
export const SEED = "data-seed"

function setAttributes(element: Element, attrs: SvgNode["attrs"]): void {
  for (const [name, value] of Object.entries(attrs)) {
    const rendered = attributeString(value)
    if (element.getAttribute(name) !== rendered) element.setAttribute(name, rendered)
  }
}

function syncAttributes(element: Element, attrs: SvgNode["attrs"]): void {
  for (const name of element.getAttributeNames()) {
    if (!(name in attrs) && !name.startsWith(LIVEVIEW_ATTRIBUTE_PREFIX)) element.removeAttribute(name)
  }
  setAttributes(element, attrs)
}

function syncNode(element: Element, node: SvgNode): void {
  syncAttributes(element, node.attrs)
  if (node.text === undefined) {
    renderNodes(element, node.children ?? [])
  } else if (element.textContent !== node.text) {
    element.textContent = node.text
  }
}

function createNode(node: SvgNode): Element {
  const element = document.createElementNS(SVG_NS, node.tag)
  syncNode(element, node)
  return element
}

export function renderNodes(parent: Element, nodes: readonly SvgNode[]): void {
  nodes.forEach((node, index) => {
    const existing = parent.children.item(index)
    if (existing === null) {
      parent.append(createNode(node))
    } else if (existing.localName === node.tag) {
      syncNode(existing, node)
    } else {
      existing.replaceWith(createNode(node))
    }
  })
  for (const extra of [...parent.children].slice(nodes.length)) extra.remove()
}

export function pointsAttribute(points: readonly Point[]): string {
  return points.map(({ x, y }) => `${String(x)},${String(y)}`).join(" ")
}

export function setLivePoints(element: Element, points: readonly Point[]): void {
  if (points.length === 0) {
    element.removeAttribute(LIVE_POINTS)
  } else {
    setAttributes(element, { [LIVE_POINTS]: pointsAttribute(points) })
  }
}

export function placeElement(wrapper: Element, { x, y, width, height }: Box, points: readonly Point[]): void {
  setAttributes(wrapper, { x, y, width, height, transform: `translate(${String(x)} ${String(y)})` })
  setLivePoints(wrapper, points)
}

export function isSeed(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= GEOMETRY.maxSeed
}

export function randomSeed(): number {
  return Math.floor(Math.random() * (GEOMETRY.maxSeed + 1))
}

function seedOf(wrapper: Element): number {
  const seed = Number(wrapper.getAttribute(SEED))
  return isSeed(seed) ? seed : 0
}

export function renderElement(wrapper: Element, renderer: Renderer, box: Box, points: readonly Point[], text: string): void {
  placeElement(wrapper, box, points)
  renderNodes(wrapper, renderer({ width: box.width, height: box.height, points, text, seed: seedOf(wrapper) }))
}
