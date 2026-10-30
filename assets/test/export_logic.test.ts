import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { EXPORT_ACTIONS } from "../js/generated/manifest.ts"
import {
  MAX_PNG_PIXELS,
  cropViewBox,
  exportActionFor,
  exportFilename,
  includedCandidates,
  inlinedProperties,
  keepsWrapperAttribute,
  markerReferences,
  matchesChord,
  paintFromRgba,
  pngSize,
  unionBounds,
  type Candidate,
} from "../js/export/export_logic.ts"
import type { Box } from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 500 }

const box = fc.record({
  x: fc.integer({ min: 0, max: 3900 }),
  y: fc.integer({ min: 0, max: 3900 }),
  width: fc.integer({ min: 0, max: 100 }),
  height: fc.integer({ min: 0, max: 100 }),
})

const boxes = fc.array(box, { minLength: 1, maxLength: 20 })

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  )
}

void test("the crop contains every included element's box", () => {
  fc.assert(
    fc.property(boxes, (all) => {
      const crop = cropViewBox(all)
      assert.ok(crop !== undefined)
      for (const element of all) assert.ok(contains(crop, element))
    }),
    settings,
  )
})

void test("the crop is the tight bounds plus exactly 16 px on every side", () => {
  fc.assert(
    fc.property(boxes, (all) => {
      const bounds = unionBounds(all)
      const crop = cropViewBox(all)
      assert.ok(bounds !== undefined && crop !== undefined)
      assert.equal(crop.x, bounds.x - 16)
      assert.equal(crop.y, bounds.y - 16)
      assert.equal(crop.width, bounds.width + 32)
      assert.equal(crop.height, bounds.height + 32)
    }),
    settings,
  )
})

void test("the tight bounds touch the content on all four sides", () => {
  fc.assert(
    fc.property(boxes, (all) => {
      const bounds = unionBounds(all)
      assert.ok(bounds !== undefined)
      assert.equal(bounds.x, Math.min(...all.map(({ x }) => x)))
      assert.equal(bounds.y, Math.min(...all.map(({ y }) => y)))
      assert.equal(bounds.x + bounds.width, Math.max(...all.map(({ x, width }) => x + width)))
      assert.equal(bounds.y + bounds.height, Math.max(...all.map(({ y, height }) => y + height)))
    }),
    settings,
  )
})

void test("an empty board has no crop", () => {
  assert.equal(cropViewBox([]), undefined)
})

void test("one element at the origin is cropped to its size plus 16 px each side", () => {
  assert.deepEqual(cropViewBox([{ x: 100, y: 50, width: 120, height: 80 }]), { x: 84, y: 34, width: 152, height: 112 })
})

const candidates = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 }).map((ids): Candidate[] =>
  ids.map((id, index) => ({ id, box: { x: index, y: index, width: 10, height: 10 } })),
)

void test("only-selected keeps exactly the selected element", () => {
  fc.assert(
    fc.property(candidates, fc.nat(), (all, pick) => {
      const selected = all[pick % all.length]
      assert.ok(selected !== undefined)
      assert.deepEqual(includedCandidates(all, { onlySelected: true, selectedId: selected.id }), [selected])
    }),
    settings,
  )
})

void test("without only-selected, or without a selection, every element is kept", () => {
  fc.assert(
    fc.property(candidates, (all) => {
      assert.deepEqual(includedCandidates(all, { onlySelected: false, selectedId: all[0]?.id }), all)
      assert.deepEqual(includedCandidates(all, { onlySelected: true, selectedId: undefined }), all)
    }),
    settings,
  )
})

void test("the filename carries the first 8 characters of the board id and a local date and time", () => {
  const now = new Date(2026, 9, 5, 7, 4)
  assert.equal(exportFilename("0123abcd-4567-89ab-cdef-0123456789ab", now, "png"), "sketch-0123abcd-20261005-0704.png")
  assert.equal(exportFilename("0123abcd-4567-89ab-cdef-0123456789ab", now, "svg"), "sketch-0123abcd-20261005-0704.svg")
})

void test("every filename matches the documented pattern", () => {
  fc.assert(
    fc.property(fc.uuid(), fc.date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31), noInvalidDate: true }), fc.constantFrom("png", "svg"), (id, now, format) => {
      assert.match(exportFilename(id, now, format), /^sketch-[0-9a-f]{8}-\d{8}-\d{4}\.(png|svg)$/)
    }),
    settings,
  )
})

void test("the PNG never exceeds the pixel cap and keeps whole pixels", () => {
  fc.assert(
    fc.property(
      fc.record({ x: fc.constant(0), y: fc.constant(0), width: fc.integer({ min: 1, max: 4100 }), height: fc.integer({ min: 1, max: 4100 }) }),
      fc.double({ min: 0.5, max: 4, noNaN: true }),
      (area, ratio) => {
        const size = pngSize(area, ratio)
        assert.ok(size.width >= 1 && size.height >= 1)
        assert.ok(size.width * size.height <= Math.max(MAX_PNG_PIXELS, 1))
        assert.ok(size.width <= Math.ceil(area.width * ratio) && size.height <= Math.ceil(area.height * ratio))
      },
    ),
    settings,
  )
})

void test("a small area is rendered at the device pixel ratio", () => {
  assert.deepEqual(pngSize({ x: 0, y: 0, width: 152, height: 112 }, 2), { width: 304, height: 224 })
  assert.deepEqual(pngSize({ x: 0, y: 0, width: 152, height: 112 }, Number.NaN), { width: 152, height: 112 })
})

void test("paint is a lowercase hex colour with an opacity, and a fully transparent colour is none", () => {
  assert.deepEqual(paintFromRgba({ r: 255, g: 0, b: 171, a: 255 }), { value: "#ff00ab", opacity: 1 })
  assert.deepEqual(paintFromRgba({ r: 1, g: 2, b: 3, a: 0 }), { value: "none", opacity: 1 })
  assert.deepEqual(paintFromRgba({ r: 0, g: 0, b: 0, a: 51 }), { value: "#000000", opacity: 0.2 })
})

void test("groups inline nothing, text inlines fonts, shapes inline paint and stroke", () => {
  assert.deepEqual(inlinedProperties("g"), [])
  assert.ok(inlinedProperties("text").includes("font-family"))
  assert.ok(!inlinedProperties("path").includes("font-family"))
  for (const property of ["fill", "stroke", "stroke-width", "stroke-dasharray"]) assert.ok(inlinedProperties("path").includes(property))
})

void test("an element wrapper keeps its position and identity but not its classes", () => {
  assert.ok(keepsWrapperAttribute("transform") && keepsWrapperAttribute("data-element"))
  assert.ok(!keepsWrapperAttribute("class") && !keepsWrapperAttribute("id") && !keepsWrapperAttribute("data-text"))
})

void test("marker references are read from url() values", () => {
  assert.deepEqual(markerReferences("url(#arrowhead-red)"), ["arrowhead-red"])
  assert.deepEqual(markerReferences("none"), [])
})

void test("shortcut chords match only their exact modifiers", () => {
  const open = { code: "KeyE", mod: true, shift: true, alt: false }
  const press = { code: "KeyE", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }
  assert.ok(matchesChord(open, press))
  assert.ok(matchesChord(open, { ...press, ctrlKey: false, metaKey: true }))
  assert.ok(!matchesChord(open, { ...press, shiftKey: false }))
  assert.ok(!matchesChord(open, { ...press, altKey: true }))
  assert.ok(!matchesChord(open, { ...press, ctrlKey: false }))
  assert.ok(!matchesChord(open, { ...press, code: "KeyC" }))
})

void test("the registry's chords resolve to their actions", () => {
  assert.equal(exportActionFor({ code: "KeyE", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), "open_menu")
  assert.equal(exportActionFor({ code: "KeyC", ctrlKey: false, metaKey: false, shiftKey: true, altKey: true }), "copy_png")
  assert.equal(exportActionFor({ code: "KeyC", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), undefined)
  assert.equal(EXPORT_ACTIONS.length, 4)
})
