import {
  DASH_ARRAYS,
  KIND_SPECS,
  STYLE_DEFAULTS,
  STYLE_TOKEN_DATA,
  STYLE_PROPERTIES,
  STYLE_TOKENS,
  type ElementKind,
  type StyleProperty,
  type StyleToken,
} from "../generated/manifest.ts"
import type { AttributeValue } from "./renderer.ts"

export type ElementStyle = { readonly [P in StyleProperty]: StyleToken<P> }

export type StylePasses = "sketch" | "single"

export const DEFAULT_STYLE: ElementStyle = STYLE_DEFAULTS

export function isStyleProperty(value: unknown): value is StyleProperty {
  return STYLE_PROPERTIES.some((property) => property === value)
}

export function isStyleToken<P extends StyleProperty>(property: P, value: unknown): value is StyleToken<P> {
  const tokens: readonly string[] = STYLE_TOKENS[property]
  return typeof value === "string" && tokens.includes(value)
}

export function withToken<P extends StyleProperty>(style: ElementStyle, property: P, token: StyleToken<P>): ElementStyle {
  return { ...style, [property]: token }
}

export function styleFrom(read: (property: StyleProperty) => unknown): ElementStyle {
  return STYLE_PROPERTIES.reduce<ElementStyle>((style, property) => {
    const value = read(property)
    return isStyleToken(property, value) ? withToken(style, property, value) : style
  }, DEFAULT_STYLE)
}

export function appliesTo(kind: ElementKind, property: StyleProperty): boolean {
  const applicable: readonly StyleProperty[] = KIND_SPECS[kind].style
  return applicable.includes(property)
}

export function styleForKind(kind: ElementKind, style: ElementStyle): ElementStyle {
  return styleFrom((property) => (appliesTo(kind, property) ? style[property] : DEFAULT_STYLE[property]))
}

export function fillClass({ fill_color }: ElementStyle): string {
  return `fill-palette-${fill_color}`
}

export function inkClass({ stroke_color }: ElementStyle): string {
  return `ink-palette-${stroke_color}`
}

export function strokeClass({ stroke_color }: ElementStyle): string {
  return `stroke-palette-${stroke_color}`
}

export function arrowheadId(strokeColor: StyleToken<"stroke_color">): string {
  return `arrowhead-${strokeColor}`
}

export function strokeAttrs({ stroke_width, stroke_style }: ElementStyle, passes: StylePasses): Record<string, AttributeValue> {
  const width = passes === "sketch" ? STYLE_TOKEN_DATA.stroke_width[stroke_width].sketch : STYLE_TOKEN_DATA.stroke_width[stroke_width].stroke
  const dashArray = DASH_ARRAYS[stroke_style][stroke_width]
  return dashArray === null ? { "stroke-width": width } : { "stroke-width": width, "stroke-dasharray": dashArray }
}
