import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { anyStyle } from "./style_arbitrary.ts"
import { ELEMENT_KINDS, KIND_SPECS, STYLE_DEFAULTS, STYLE_PROPERTIES, type StyleProperty } from "../js/generated/manifest.ts"
import {
  DEFAULT_STYLE,
  appliesTo,
  isStyleToken,
  styleForKind,
  styleFrom,
  strokeAttrs,
} from "../js/elements/style.ts"

const settings = { seed: 1, numRuns: 500 }


void test("the default style is the registry's default for every property, and a token of it (mix sketch.gen.manifest)", () => {
  for (const property of STYLE_PROPERTIES) {
    assert.equal(DEFAULT_STYLE[property], STYLE_DEFAULTS[property])
    assert.equal(isStyleToken(property, DEFAULT_STYLE[property]), true)
  }
})

void test("a kind's style properties come from its generated spec, and every property applies to some kind", () => {
  for (const kind of ELEMENT_KINDS) {
    const declared: readonly StyleProperty[] = KIND_SPECS[kind].style
    for (const property of STYLE_PROPERTIES) assert.equal(appliesTo(kind, property), declared.includes(property))
  }
  for (const property of STYLE_PROPERTIES) assert.ok(ELEMENT_KINDS.some((kind) => appliesTo(kind, property)), property)
})

void test("the style for a kind keeps applicable tokens and resets the others to their default", () => {
  fc.assert(
    fc.property(fc.constantFrom(...ELEMENT_KINDS), anyStyle, (kind, style) => {
      const forKind = styleForKind(kind, style)
      for (const property of STYLE_PROPERTIES) {
        assert.equal(forKind[property], appliesTo(kind, property) ? style[property] : DEFAULT_STYLE[property])
      }
    }),
    settings,
  )
})

void test("reading a style keeps known tokens and falls back to the default for anything else", () => {
  fc.assert(
    fc.property(anyStyle, fc.dictionary(fc.constantFrom(...STYLE_PROPERTIES), fc.oneof(fc.string(), fc.constant(null))), (style, junk) => {
      assert.deepEqual(
        styleFrom((property) => style[property]),
        style,
      )
      const read = styleFrom((property) => junk[property])
      for (const property of STYLE_PROPERTIES) {
        const value = junk[property]
        assert.equal(read[property], isStyleToken(property, value) ? value : DEFAULT_STYLE[property])
      }
    }),
    settings,
  )
})

void test("a solid stroke has no dash array and a dashed or dotted one always has one", () => {
  fc.assert(
    fc.property(anyStyle, fc.constantFrom("sketch" as const, "single" as const), (style, passes) => {
      const attrs = strokeAttrs(style, passes)
      assert.equal("stroke-dasharray" in attrs, style.stroke_style !== "solid")
      assert.ok(Number(attrs["stroke-width"]) > 0)
    }),
    settings,
  )
})
