import type { Box } from "../hooks/canvas_logic.ts"
import {
  cropViewBox,
  includedCandidates,
  inlinedProperties,
  isPaintProperty,
  keepsWrapperAttribute,
  markerReferences,
  paintFromRgba,
  pngSize,
  type Candidate,
  type Paint,
  type Scope,
} from "./export_logic.ts"

const SVG_NS = "http://www.w3.org/2000/svg"
const XML_NS = "http://www.w3.org/XML/1998/namespace"
const ELEMENT_SELECTOR = "#elements > [data-element]"
const BLOB_URL_LIFETIME_MS = 60_000

export interface ExportOptions extends Scope {
  readonly background: boolean
}

export interface ExportSvg {
  readonly markup: string
  readonly box: Box
}

class ColorResolver {
  private readonly context: CanvasRenderingContext2D
  private readonly cache = new Map<string, Paint>()

  constructor() {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (context === null) throw new Error("a 2D canvas is not available")
    this.context = context
  }

  resolve(css: string): Paint {
    const cached = this.cache.get(css)
    if (cached !== undefined) return cached
    const paint = this.paint(css)
    this.cache.set(css, paint)
    return paint
  }

  private paint(css: string): Paint {
    if (css === "none") return { value: "none", opacity: 1 }
    this.context.clearRect(0, 0, 1, 1)
    this.context.fillStyle = "rgba(0, 0, 0, 0)"
    this.context.fillStyle = css
    this.context.fillRect(0, 0, 1, 1)
    const [r = 0, g = 0, b = 0, a = 0] = this.context.getImageData(0, 0, 1, 1).data
    return paintFromRgba({ r, g, b, a })
  }
}

function liveBox(element: Element): Box {
  const [x, y, width, height] = ["x", "y", "width", "height"].map((name) => Number(element.getAttribute(name)))
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 }
}

function setPaint(clone: Element, property: string, css: string, colors: ColorResolver): void {
  const paint = colors.resolve(css)
  clone.setAttribute(property, paint.value)
  if (paint.opacity < 1) {
    clone.setAttribute(`${property}-opacity`, String(paint.opacity))
  } else {
    clone.removeAttribute(`${property}-opacity`)
  }
}

function stripAttributes(clone: Element, isWrapper: boolean): void {
  for (const name of clone.getAttributeNames()) {
    const drop = isWrapper ? !keepsWrapperAttribute(name) : name === "class" || name === "id" || name.startsWith("data-phx-")
    if (drop) clone.removeAttribute(name)
  }
}

function inlineStyles(source: Element, clone: Element, colors: ColorResolver, isWrapper: boolean): void {
  const computed = getComputedStyle(source)
  for (const property of inlinedProperties(source.localName)) {
    const value = computed.getPropertyValue(property)
    if (isPaintProperty(property)) {
      setPaint(clone, property, value, colors)
    } else if (value !== "") {
      clone.setAttribute(property, value)
    }
  }
  if (computed.filter !== "none" && clone instanceof SVGElement) clone.style.filter = computed.filter
  if (source.localName === "text") clone.setAttributeNS(XML_NS, "xml:space", "preserve")
  stripAttributes(clone, isWrapper)
  Array.from(source.children).forEach((child, index) => {
    const cloneChild = clone.children.item(index)
    if (cloneChild !== null) inlineStyles(child, cloneChild, colors, false)
  })
}

function usedMarkerIds(root: Element): string[] {
  const ids = new Set<string>()
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) {
      for (const id of markerReferences(element.getAttribute(name) ?? "")) ids.add(id)
    }
  }
  return [...ids]
}

function inlineMarkers(canvas: Element, used: Element, colors: ColorResolver): Element {
  const defs = document.createElementNS(SVG_NS, "defs")
  for (const id of usedMarkerIds(used)) {
    const marker = canvas.querySelector(`defs > marker[id="${CSS.escape(id)}"]`)
    if (marker === null) continue
    const clone = marker.cloneNode(true)
    if (!(clone instanceof Element)) continue
    inlineStyles(marker, clone, colors, false)
    clone.setAttribute("id", id)
    defs.append(clone)
  }
  return defs
}

function includedElements(canvas: Element, scope: Scope): { element: Element; candidate: Candidate }[] {
  const all = Array.from(canvas.querySelectorAll(ELEMENT_SELECTOR)).map((element) => ({
    element,
    candidate: { id: element.getAttribute("data-element") ?? "", box: liveBox(element) },
  }))
  const included = new Set(includedCandidates(all.map(({ candidate }) => candidate), scope).map(({ id }) => id))
  return all.filter(({ candidate }) => included.has(candidate.id))
}

export function buildSvg(canvas: SVGSVGElement, options: ExportOptions): ExportSvg | undefined {
  const included = includedElements(canvas, options)
  const box = cropViewBox(included.map(({ candidate }) => candidate.box))
  if (box === undefined) return undefined

  const colors = new ColorResolver()
  const content = document.createElementNS(SVG_NS, "g")
  for (const { element } of included) {
    const clone = element.cloneNode(true)
    if (!(clone instanceof Element)) continue
    inlineStyles(element, clone, colors, true)
    content.append(clone)
  }

  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("xmlns", SVG_NS)
  svg.setAttribute("width", String(box.width))
  svg.setAttribute("height", String(box.height))
  svg.setAttribute("viewBox", `${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`)
  svg.append(inlineMarkers(canvas, content, colors))
  if (options.background) {
    const background = document.createElementNS(SVG_NS, "rect")
    for (const [name, value] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) {
      background.setAttribute(name, String(value))
    }
    setPaint(background, "fill", getComputedStyle(canvas).backgroundColor, colors)
    svg.append(background)
  }
  svg.append(content)
  return { markup: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`, box }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("the browser could not encode the PNG"))
      } else {
        resolve(blob)
      }
    }, "image/png")
  })
}

export async function renderPng({ markup, box }: ExportSvg, devicePixelRatio: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const size = pngSize(box, devicePixelRatio)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext("2d")
    if (context === null) throw new Error("a 2D canvas is not available")
    context.drawImage(image, 0, 0, size.width, size.height)
    return await canvasBlob(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function svgBlob({ markup }: ExportSvg): Blob {
  return new Blob([markup], { type: "image/svg+xml" })
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, BLOB_URL_LIFETIME_MS)
}

export async function copyPng(png: Promise<Blob>, { markup }: ExportSvg): Promise<void> {
  const svgText = new Blob([markup], { type: "text/plain" })
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png, "text/plain": svgText })])
}
