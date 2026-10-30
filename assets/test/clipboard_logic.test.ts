import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import {
  DUPLICATE_OFFSET,
  ENVELOPE_TYPE,
  MAX_PASTED_ELEMENTS,
  clipboardActionFor,
  decodeClipboard,
  duplicated,
  encodeElements,
  pastedText,
  placedAround,
  validElement,
} from "../js/hooks/clipboard_logic.ts"
import type { ElementSnapshot } from "../js/hooks/element_history.ts"
import { pointerAction } from "../js/hooks/tools.ts"
import { DEFAULT_STYLE, styleForKind } from "../js/elements/style.ts"
import { ELEMENT_KINDS, GEOMETRY, KIND_SPECS, STYLE_TOKENS, type ElementKind } from "../js/generated/manifest.ts"
import { press } from "./key_press.ts"

const settings = { seed: 1, numRuns: 1000 }
const canvas = { width: GEOMETRY.canvasWidth, height: GEOMETRY.canvasHeight }
const anyKind = fc.constantFrom<ElementKind>(...ELEMENT_KINDS)
const anySeed = fc.integer({ min: 0, max: GEOMETRY.maxSeed })

const anyStyle = fc.record({
  stroke_color: fc.constantFrom(...STYLE_TOKENS.stroke_color),
  fill_color: fc.constantFrom(...STYLE_TOKENS.fill_color),
  stroke_width: fc.constantFrom(...STYLE_TOKENS.stroke_width),
  stroke_style: fc.constantFrom(...STYLE_TOKENS.stroke_style),
})

const visibleText = fc.string({ minLength: 1, maxLength: 40 }).filter((text) => text.trim() !== "" && !text.includes("\0"))

function pointsIn(kind: ElementKind, width: number, height: number): fc.Arbitrary<{ x: number; y: number }[]> {
  const { geometry } = KIND_SPECS[kind]
  if (geometry === "box") return fc.constant([])
  const point = fc.tuple(fc.integer({ min: 0, max: width }), fc.integer({ min: 0, max: height })).map(([x, y]) => ({ x, y }))
  return fc.array(point, { minLength: geometry.points.min, maxLength: Math.min(geometry.points.max, 6) })
}

function textFor(kind: ElementKind): fc.Arbitrary<string> {
  const rule = KIND_SPECS[kind].text
  if (rule === "none") return fc.constant("")
  return rule === "required" ? visibleText : fc.oneof(fc.constant(""), visibleText)
}

const anySnapshot: fc.Arbitrary<ElementSnapshot> = anyKind.chain((kind) => {
  const least = KIND_SPECS[kind].geometry === "box" ? 1 : 0
  return fc
    .record({
      width: fc.integer({ min: least, max: 500 }),
      height: fc.integer({ min: least, max: 500 }),
      seed: anySeed,
      style: anyStyle.map((style) => styleForKind(kind, style)),
    })
    .chain(({ width, height, seed, style }) =>
      fc.record({
        kind: fc.constant(kind),
        x: fc.integer({ min: 0, max: canvas.width - width }),
        y: fc.integer({ min: 0, max: canvas.height - height }),
        width: fc.constant(width),
        height: fc.constant(height),
        points: pointsIn(kind, width, height),
        text: textFor(kind),
        seed: fc.constant(seed),
        style: fc.constant(style),
      }),
    )
})

const anyGroup = fc.array(anySnapshot.map((element) => ({ ...element })), { minLength: 1, maxLength: 5 })
const anyPoint = fc.record({ x: fc.integer({ min: -1000, max: 6000 }), y: fc.integer({ min: -1000, max: 6000 }) })

function inCanvas(element: ElementSnapshot): boolean {
  return element.x >= 0 && element.y >= 0 && element.x + element.width <= canvas.width && element.y + element.height <= canvas.height
}

const rectangle: ElementSnapshot = {
  kind: "rectangle",
  x: 100,
  y: 120,
  width: 80,
  height: 60,
  points: [],
  text: "",
  seed: 7,
  style: { ...DEFAULT_STYLE, stroke_color: "red" },
}

void test("decode(encode(x)) is x for every valid group of elements", () => {
  fc.assert(
    fc.property(anyGroup, (group) => {
      assert.deepEqual(decodeClipboard(encodeElements(group)), { status: "elements", elements: group })
    }),
    settings,
  )
})

void test("the envelope is versioned JSON with the flat element fields", () => {
  const parsed: unknown = JSON.parse(encodeElements([rectangle]))
  assert.deepEqual(parsed, {
    type: ENVELOPE_TYPE,
    version: 1,
    elements: [
      {
        kind: "rectangle",
        x: 100,
        y: 120,
        width: 80,
        height: 60,
        points: [],
        text: "",
        stroke_color: "red",
        fill_color: "auto",
        stroke_width: "thin",
        stroke_style: "solid",
        seed: 7,
      },
    ],
  })
})

void test("decode never throws on arbitrary strings and plain strings come back as text", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 300 }), (text) => {
      const decoded = decodeClipboard(text)
      assert.ok(["elements", "text", "rejected"].includes(decoded.status))
      if (decoded.status === "text") assert.equal(decoded.text, text)
    }),
    settings,
  )
})

void test("decode never throws on arbitrary JSON values, including envelopes with wrong parts", () => {
  fc.assert(
    fc.property(fc.jsonValue(), fc.jsonValue(), (version, elements) => {
      for (const value of [version, { type: ENVELOPE_TYPE, version, elements }, { type: ENVELOPE_TYPE, version: 1, elements }]) {
        const decoded = decodeClipboard(JSON.stringify(value))
        assert.ok(["elements", "text", "rejected"].includes(decoded.status))
      }
    }),
    settings,
  )
})

void test("deeply nested JSON and long text do not throw", () => {
  assert.equal(decodeClipboard("[".repeat(200_000)).status, "text")
  assert.equal(decodeClipboard(`{"type":"${ENVELOPE_TYPE}","elements":${"[".repeat(200_000)}`).status, "rejected")
})

function envelopeOf(element: unknown, version: unknown = 1): string {
  return JSON.stringify({ type: ENVELOPE_TYPE, version, elements: [element] })
}

const validFlat: Record<string, unknown> = {
  kind: "rectangle",
  x: 1,
  y: 2,
  width: 3,
  height: 4,
  points: [],
  text: "",
  stroke_color: "ink",
  fill_color: "auto",
  stroke_width: "thin",
  stroke_style: "solid",
  seed: 0,
}

void test("an element of an unknown kind is rejected, and so is every envelope containing one", () => {
  for (const kind of ["bogus", "", "Rectangle", 3, null, undefined, "__proto__", "constructor"]) {
    assert.equal(decodeClipboard(envelopeOf({ ...validFlat, kind })).status, "rejected")
  }
  const mixed = JSON.stringify({ type: ENVELOPE_TYPE, version: 1, elements: [validFlat, { ...validFlat, kind: "bogus" }] })
  assert.equal(decodeClipboard(mixed).status, "rejected")
  assert.equal(decodeClipboard(envelopeOf(validFlat)).status, "elements")
})

void test("each rule the server enforces is checked before paste", () => {
  const broken: Record<string, unknown>[] = [
    { x: -1 },
    { y: 1.5 },
    { width: 0 },
    { height: "4" },
    { x: 3999, width: 3 },
    { y: 4000, height: 1 },
    { seed: -1 },
    { seed: GEOMETRY.maxSeed + 1 },
    { stroke_color: "magenta" },
    { fill_color: 1 },
    { stroke_width: undefined },
    { text: "not allowed on a rectangle" },
    { points: [{ x: 0, y: 0 }] },
    { kind: "arrow", points: [{ x: 0, y: 0 }] },
    { kind: "arrow", points: [{ x: 0, y: 0 }, { x: 9, y: 0 }] },
    { kind: "line", points: [{ x: 0, y: 0 }, { x: 1.5, y: 0 }] },
    { kind: "text", width: 5, height: 25, text: "   " },
    { kind: "text", width: 5, height: 25, text: "" },
    { kind: "text", width: 5, height: 25, text: "a\0b" },
    { kind: "note", text: "x".repeat(GEOMETRY.maxTextLength + 1) },
  ]
  for (const change of broken) assert.equal(decodeClipboard(envelopeOf({ ...validFlat, ...change })).status, "rejected", JSON.stringify(change))
  assert.equal(decodeClipboard(envelopeOf({ ...validFlat, kind: "arrow", width: 3, height: 4, points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] })).status, "elements")
  assert.equal(decodeClipboard(envelopeOf({ ...validFlat, kind: "note", text: "x".repeat(GEOMETRY.maxTextLength) })).status, "elements")
})

void test("an unsupported version, no elements or too many are rejected", () => {
  for (const version of [0, 2, "1", null]) assert.equal(decodeClipboard(envelopeOf(validFlat, version)).status, "rejected")
  const many = Array.from({ length: MAX_PASTED_ELEMENTS + 1 }, () => validFlat)
  for (const elements of [[], many, "x", null]) {
    assert.equal(decodeClipboard(JSON.stringify({ type: ENVELOPE_TYPE, version: 1, elements })).status, "rejected")
  }
})

void test("a style property that does not apply to the kind is reset, as the server requires", () => {
  const decoded = validElement({ ...validFlat, kind: "text", width: 5, height: 25, text: "hi", fill_color: "red", stroke_width: "bold" })
  assert.deepEqual(decoded?.style, { ...DEFAULT_STYLE })
})

void test("text that mentions the envelope but is not one is rejected, other text and JSON are text", () => {
  assert.equal(decodeClipboard(`{"type":"${ENVELOPE_TYPE}","vers`).status, "rejected")
  assert.equal(decodeClipboard('{"type":"other"}').status, "text")
  assert.equal(decodeClipboard("hello").status, "text")
})

void test("a duplicate is offset by 10 and stays inside the canvas", () => {
  assert.deepEqual(duplicated([rectangle], canvas), [{ ...rectangle, x: 100 + DUPLICATE_OFFSET, y: 120 + DUPLICATE_OFFSET }])
  fc.assert(
    fc.property(anyGroup, (group) => {
      for (const copy of duplicated(group, canvas)) assert.ok(inCanvas(copy))
    }),
    settings,
  )
})

void test("a duplicate at the edge is clamped instead of leaving the canvas", () => {
  const edge = { ...rectangle, x: canvas.width - rectangle.width, y: canvas.height - rectangle.height }
  assert.deepEqual(duplicated([edge], canvas), [edge])
})

void test("a duplicate keeps everything but the position", () => {
  fc.assert(
    fc.property(anyGroup, (group) => {
      const copies = duplicated(group, canvas)
      assert.equal(copies.length, group.length)
      copies.forEach((copy, index) => {
        const original = group[index] ?? copy
        assert.ok(Number.isInteger(copy.x) && Number.isInteger(copy.y))
        assert.deepEqual({ ...copy, x: 0, y: 0 }, { ...original, x: 0, y: 0 })
      })
    }),
    settings,
  )
})

void test("a pasted group always lands inside the canvas, whatever the pointer", () => {
  fc.assert(
    fc.property(anyGroup, anyPoint, (group, center) => {
      for (const element of placedAround(group, center, canvas)) assert.ok(inCanvas(element), JSON.stringify(element))
    }),
    settings,
  )
})

void test("a pasted group is centred on the pointer when it fits, and keeps its internal layout", () => {
  const placed = placedAround([rectangle], { x: 1000, y: 700 }, canvas)
  assert.deepEqual(placed, [{ ...rectangle, x: 960, y: 670 }])
  fc.assert(
    fc.property(anyGroup, (group) => {
      const placed = placedAround(group, { x: 2000, y: 2000 }, canvas)
      const [first, ...rest] = group
      const [placedFirst, ...placedRest] = placed
      if (first === undefined || placedFirst === undefined) return
      rest.forEach((element, index) => {
        const moved = placedRest[index]
        assert.equal((moved?.x ?? NaN) - placedFirst.x, element.x - first.x)
        assert.equal((moved?.y ?? NaN) - placedFirst.y, element.y - first.y)
      })
    }),
    settings,
  )
})

const measure = (line: string): number => line.length * 10
const textPaste = (at = { x: 50, y: 60 }) => ({ at, measure, lineHeight: GEOMETRY.lineHeight, canvas, seed: 5, style: DEFAULT_STYLE })

void test("plain text becomes a text element at the pointer", () => {
  const element = pastedText("hello\r\nworld", textPaste())
  assert.deepEqual(element, {
    kind: "text",
    x: 50,
    y: 60,
    width: 50,
    height: 2 * GEOMETRY.lineHeight,
    points: [],
    text: "hello\nworld",
    seed: 5,
    style: DEFAULT_STYLE,
  })
})

void test("text that does not fit the text rules is not pasted", () => {
  for (const text of ["", "   \n\t", "a\0b", "x".repeat(GEOMETRY.maxTextLength + 1), "a\n".repeat(1000)]) {
    assert.equal(pastedText(text, textPaste()), undefined)
  }
})

void test("pasted text is a valid element and stays inside the canvas wherever it lands", () => {
  fc.assert(
    fc.property(visibleText, anyPoint, (text, at) => {
      const element = pastedText(text, textPaste(at))
      if (element === undefined) return
      assert.ok(inCanvas(element))
      assert.deepEqual(validElement(JSON.parse(JSON.stringify(flatOf(element)))), element)
    }),
    settings,
  )
})

function flatOf(element: ElementSnapshot): Record<string, unknown> {
  const parsed: unknown = JSON.parse(encodeElements([element]))
  return typeof parsed === "object" && parsed !== null && "elements" in parsed && Array.isArray(parsed.elements) ? (parsed.elements[0] as Record<string, unknown>) : {}
}

void test("Ctrl or Command with D, C, X and V pick the clipboard actions on the canvas only", () => {
  const chords = { KeyD: "duplicate", KeyC: "copy", KeyX: "cut", KeyV: "paste" } as const
  for (const [code, action] of Object.entries(chords)) {
    assert.equal(clipboardActionFor({ ...press(code, { ctrlKey: true }), editable: false }), action)
    assert.equal(clipboardActionFor({ ...press(code, { metaKey: true }), editable: false }), action)
    assert.equal(clipboardActionFor({ ...press(code, { ctrlKey: true }), editable: true }), undefined)
    assert.equal(clipboardActionFor({ ...press(code), editable: false }), undefined)
    assert.equal(clipboardActionFor({ ...press(code, { ctrlKey: true, shiftKey: true }), editable: false }), undefined)
    assert.equal(clipboardActionFor({ ...press(code, { ctrlKey: true, altKey: true }), editable: false }), undefined)
  }
})

void test("Alt on an element with Selection copies it; without Alt it moves; Alt on a handle still resizes", () => {
  const base = { button: 0, tool: "selection", spaceHeld: false, onElement: true, onHandle: false } as const
  assert.equal(pointerAction({ ...base, altKey: true }), "copy")
  assert.equal(pointerAction({ ...base, altKey: false }), "move")
  assert.equal(pointerAction(base), "move")
  assert.equal(pointerAction({ ...base, altKey: true, onHandle: true }), "resize")
  assert.equal(pointerAction({ ...base, altKey: true, onElement: false }), "marquee")
  assert.equal(pointerAction({ ...base, altKey: true, tool: "rectangle" }), "draw")
})
