import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { textBox, textLines, wrapText, type Box, type Size } from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 1000 }

const canvas: fc.Arbitrary<Size> = fc.record({
  width: fc.integer({ min: 1, max: 5000 }),
  height: fc.integer({ min: 1, max: 5000 }),
})
const origin = fc.record({
  x: fc.double({ min: -2000, max: 7000, noNaN: true }),
  y: fc.double({ min: -2000, max: 7000, noNaN: true }),
})
const lineHeight = fc.integer({ min: 1, max: 60 })
const charWidth = fc.double({ min: 0.5, max: 40, noNaN: true })
const anyText = fc.oneof(
  fc.string({ unit: fc.constantFrom("a", "W", " ", "\n", "\r", "\t", "<", "é", "😀"), maxLength: 80 }),
  fc.string({ unit: "grapheme", maxLength: 40 }),
)

function monospace(width: number): (line: string) => number {
  return (line) => line.length * width
}

function insideCanvas(box: Box, size: Size): boolean {
  return (
    [box.x, box.y, box.width, box.height].every(Number.isInteger) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width >= 1 &&
    box.height >= 1 &&
    box.x + box.width <= size.width &&
    box.y + box.height <= size.height
  )
}

void test("splitting text yields one line per newline, CR or CRLF, and no line holds a line break", () => {
  fc.assert(
    fc.property(anyText, (text) => {
      const lines = textLines(text)
      const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0
      assert.equal(lines.length, breaks + 1)
      assert.ok(lines.every((line) => !/[\r\n]/.test(line)))
      assert.equal(lines.join("\n"), text.replace(/\r\n?/g, "\n"))
    }),
    settings,
  )
})

void test("the text box is deterministic and sized by the line count and the longest line, capped to the canvas", () => {
  fc.assert(
    fc.property(origin, anyText, charWidth, lineHeight, canvas, (at, text, width, height, size) => {
      const box = textBox(at, text, monospace(width), height, size)
      assert.deepEqual(textBox(at, text, monospace(width), height, size), box)
      const lines = textLines(text)
      const longest = Math.max(...lines.map(monospace(width)))
      assert.equal(box.height, Math.min(lines.length * height, size.height))
      assert.equal(box.width, Math.min(Math.max(1, Math.ceil(longest)), size.width))
    }),
    settings,
  )
})

void test("the text box always lies inside the canvas", () => {
  fc.assert(
    fc.property(origin, anyText, charWidth, lineHeight, canvas, (at, text, width, height, size) => {
      const box = textBox(at, text, monospace(width), height, size)
      assert.ok(insideCanvas(box, size), JSON.stringify(box))
    }),
    settings,
  )
})

void test("typing more text never shrinks the box", () => {
  fc.assert(
    fc.property(origin, anyText, anyText, charWidth, lineHeight, canvas, (at, text, more, width, height, size) => {
      const before = textBox(at, text, monospace(width), height, size)
      const after = textBox(at, text + more, monospace(width), height, size)
      assert.ok(after.width >= before.width, `${String(after.width)} < ${String(before.width)}`)
      assert.ok(after.height >= before.height, `${String(after.height)} < ${String(before.height)}`)
    }),
    settings,
  )
})

void test("an empty text still has a one-line box at least one unit wide", () => {
  fc.assert(
    fc.property(origin, charWidth, lineHeight, canvas, (at, width, height, size) => {
      const box = textBox(at, "", monospace(width), height, size)
      assert.deepEqual([box.width, box.height], [1, Math.min(height, size.height)])
    }),
    settings,
  )
})

const wrapWidth = fc.double({ min: 1, max: 600, noNaN: true })
const wrappableText = fc.string({
  unit: fc.constantFrom("a", "b", "W", "é", "😀", " ", " ", "\t", "\n", "\r\n", "-", "<"),
  maxLength: 120,
})

function characterCount(line: string): number {
  return Array.from(line).length
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s/g, "")
}

void test("wrapped lines fit the width unless a single character is wider than it", () => {
  fc.assert(
    fc.property(wrappableText, wrapWidth, charWidth, (text, width, glyph) => {
      for (const line of wrapText(text, width, glyph)) {
        assert.ok(characterCount(line) * glyph <= width || characterCount(line) === 1, JSON.stringify(line))
      }
    }),
    settings,
  )
})

void test("a word longer than the width is hard-broken into lines that fit", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 100 }), (chars, length) => {
      const lines = wrapText("x".repeat(length), chars * 10, 10)
      assert.ok(lines.every((line) => line.length <= chars))
      assert.equal(lines.join(""), "x".repeat(length))
      assert.equal(lines.length, Math.ceil(length / chars))
    }),
    settings,
  )
})

void test("wrapping keeps every non-whitespace character in order", () => {
  fc.assert(
    fc.property(wrappableText, wrapWidth, charWidth, (text, width, glyph) => {
      assert.equal(withoutWhitespace(wrapText(text, width, glyph).join("")), withoutWhitespace(text))
    }),
    settings,
  )
})

void test("explicit line breaks stay line breaks, and an empty paragraph stays an empty line", () => {
  fc.assert(
    fc.property(fc.array(wrappableText, { minLength: 1, maxLength: 5 }), wrapWidth, charWidth, (paragraphs, width, glyph) => {
      const joined = paragraphs.join("\n")
      const lines = wrapText(joined, width, glyph)
      assert.ok(lines.length >= textLines(joined).length)
      const rebuilt = paragraphs.flatMap((paragraph) => textLines(paragraph).flatMap((part) => wrapText(part, width, glyph)))
      assert.deepEqual(lines, rebuilt)
      assert.deepEqual(wrapText("a\n\nb", 1000, 1), ["a", "", "b"])
    }),
    settings,
  )
})

void test("wrapping its own output changes nothing", () => {
  fc.assert(
    fc.property(wrappableText, wrapWidth, charWidth, (text, width, glyph) => {
      const lines = wrapText(text, width, glyph)
      assert.deepEqual(wrapText(lines.join("\n"), width, glyph), lines)
    }),
    settings,
  )
})

void test("a sentence wraps at word boundaries, greedily", () => {
  assert.deepEqual(wrapText("the quick brown fox", 90, 10), ["the quick", "brown fox"])
  assert.deepEqual(wrapText("ab cd ef", 50, 10), ["ab cd", "ef"])
})
