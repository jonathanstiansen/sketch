import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { ANCHOR_SCALE, GEOMETRY } from "../js/generated/manifest.ts"
import { DEFAULT_LABEL, clampLabel, labelPoint } from "../js/elements/label.ts"
import { anchorFor } from "../js/hooks/binding_logic.ts"

const settings = { seed: 1, numRuns: 1000 }
const anyOffset = fc.record({ x: fc.integer({ min: -5000, max: 5000 }), y: fc.integer({ min: -5000, max: 5000 }) })
const box = fc
  .record({ width: fc.nat(GEOMETRY.canvasWidth), height: fc.nat(GEOMETRY.canvasHeight) })
  .chain(({ width, height }) =>
    fc.record({
      x: fc.nat(GEOMETRY.canvasWidth - width),
      y: fc.nat(GEOMETRY.canvasHeight - height),
      width: fc.constant(width),
      height: fc.constant(height),
    }),
  )

void test("a clamped label offset is inside the box and clamping twice changes nothing", () => {
  fc.assert(
    fc.property(anyOffset, (offset) => {
      const clamped = clampLabel(offset)
      assert.ok(clamped.x >= 0 && clamped.x <= ANCHOR_SCALE && clamped.y >= 0 && clamped.y <= ANCHOR_SCALE)
      assert.deepEqual(clampLabel(clamped), clamped)
    }),
    settings,
  )
})

void test("dragging a label anywhere, even off the shape, keeps its point inside the shape's box", () => {
  fc.assert(
    fc.property(box, fc.integer({ min: -2000, max: 6000 }), fc.integer({ min: -2000, max: 6000 }), (shape, x, y) => {
      const offset = anchorFor({ x, y }, shape)
      const point = labelPoint(shape.width, shape.height, offset)
      assert.ok(point.x >= 0 && point.x <= shape.width && point.y >= 0 && point.y <= shape.height, JSON.stringify({ shape, x, y }))
    }),
    settings,
  )
})

void test("the default label sits in the middle of the box", () => {
  assert.deepEqual(labelPoint(120, 80, DEFAULT_LABEL), { x: 60, y: 40 })
})
