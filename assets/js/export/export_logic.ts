import type { Box } from "../hooks/canvas_logic.ts"
import type { ExportActionId } from "../generated/manifest.ts"
import { EXPORT_ACTIONS } from "../generated/manifest.ts"

export const EXPORT_PADDING = 16
export const MAX_PNG_PIXELS = 16_000_000

export type ExportFormat = "png" | "svg"

export interface Candidate {
  readonly id: string
  readonly box: Box
}

export interface Scope {
  readonly onlySelected: boolean
  readonly selectedId: string | undefined
}

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export interface Paint {
  readonly value: string
  readonly opacity: number
}

export interface KeyChord {
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

const PAINT_PROPERTIES = ["fill", "stroke"] as const
const SHAPE_PROPERTIES = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin"] as const
const TEXT_PROPERTIES = ["fill", "font-family", "font-size", "font-weight"] as const
const KEPT_WRAPPER_ATTRIBUTES = ["transform", "data-element", "data-kind"]
const GROUPING_TAGS = ["g", "svg", "tspan", "marker", "defs"]

export function unionBounds(boxes: readonly Box[]): Box | undefined {
  const [first, ...rest] = boxes
  if (first === undefined) return undefined
  let left = first.x
  let top = first.y
  let right = first.x + first.width
  let bottom = first.y + first.height
  for (const box of rest) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width)
    bottom = Math.max(bottom, box.y + box.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function cropViewBox(boxes: readonly Box[], padding: number = EXPORT_PADDING): Box | undefined {
  const bounds = unionBounds(boxes)
  if (bounds === undefined) return undefined
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + 2 * padding,
    height: bounds.height + 2 * padding,
  }
}

export function includedCandidates(candidates: readonly Candidate[], { onlySelected, selectedId }: Scope): Candidate[] {
  if (!onlySelected || selectedId === undefined) return [...candidates]
  return candidates.filter(({ id }) => id === selectedId)
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0")
}

export function exportFilename(boardId: string, now: Date, format: ExportFormat): string {
  const date = `${String(now.getFullYear())}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}`
  const time = `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`
  return `sketch-${boardId.slice(0, 8)}-${date}-${time}.${format}`
}

export function pngSize(box: Box, devicePixelRatio: number, maxPixels: number = MAX_PNG_PIXELS): { width: number; height: number } {
  const wanted = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const scale = Math.min(wanted, Math.sqrt(maxPixels / (box.width * box.height)))
  return { width: Math.max(1, Math.floor(box.width * scale)), height: Math.max(1, Math.floor(box.height * scale)) }
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0")
}

export function paintFromRgba({ r, g, b, a }: Rgba): Paint {
  if (a === 0) return { value: "none", opacity: 1 }
  return { value: `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`, opacity: Math.round((a / 255) * 1000) / 1000 }
}

export function isPaintProperty(property: string): property is (typeof PAINT_PROPERTIES)[number] {
  return PAINT_PROPERTIES.some((paint) => paint === property)
}

export function inlinedProperties(tag: string): readonly string[] {
  if (GROUPING_TAGS.includes(tag)) return []
  return tag === "text" ? TEXT_PROPERTIES : SHAPE_PROPERTIES
}

export function keepsWrapperAttribute(name: string): boolean {
  return KEPT_WRAPPER_ATTRIBUTES.includes(name)
}

export function markerReferences(value: string): string[] {
  return [...value.matchAll(/url\(#([^)]+)\)/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
}

export function matchesChord(chord: { code: string; mod: boolean; shift: boolean; alt: boolean }, key: KeyChord): boolean {
  const mod = key.ctrlKey || key.metaKey
  return key.code === chord.code && mod === chord.mod && key.shiftKey === chord.shift && key.altKey === chord.alt
}

export function exportActionFor(key: KeyChord): ExportActionId | undefined {
  for (const action of EXPORT_ACTIONS) {
    if (action.chord !== null && matchesChord(action.chord, key)) return action.id
  }
  return undefined
}
