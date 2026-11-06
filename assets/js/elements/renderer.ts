import type { Point } from "../hooks/canvas_logic.ts"
import type { ElementStyle } from "./style.ts"

export interface LocalShape {
  readonly width: number
  readonly height: number
  readonly points: readonly Point[]
  readonly text: string
  readonly seed: number
  readonly style: ElementStyle
  readonly label?: { readonly x: number; readonly y: number }
}

export type AttributeValue = string | number

export interface SvgNode {
  readonly tag: string
  readonly attrs: Readonly<Record<string, AttributeValue>>
  readonly children?: readonly SvgNode[]
  readonly text?: string
}

export type Renderer = (shape: LocalShape) => readonly SvgNode[]

export function attributeString(value: AttributeValue): string {
  return String(value)
}
