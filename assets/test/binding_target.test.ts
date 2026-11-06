import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { ANCHOR_SCALE } from "../js/generated/manifest.ts"
import { bindingFor, boxNear, type Candidate } from "../js/hooks/binding_logic.ts"
import type { Box, Point } from "../js/hooks/canvas_logic.ts"

const margin = 12
const box: fc.Arbitrary<Box> = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 2000 }),
  width: fc.integer({ min: 1, max: 600 }),
  height: fc.integer({ min: 1, max: 600 }),
})
const candidates: fc.Arbitrary<Candidate[]> = fc
  .array(box, { minLength: 1, maxLength: 6 })
  .map((boxes) => boxes.map((b, index) => ({ id: `shape-${String(index)}`, box: b })))
const offset = fc.integer({ min: -40, max: 40 })

function pointNear(b: Box, dx: number, dy: number, fx: number, fy: number): Point {
  return { x: b.x + Math.round(b.width * fx) + dx, y: b.y + Math.round(b.height * fy) + dy }
}

void test("a point inside a shape binds to the topmost shape containing it, even when another shape's margin also covers it", () => {
  fc.assert(
    fc.property(candidates, fc.nat(), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (shapes, pick, fx, fy) => {
      const chosen = shapes[pick % shapes.length]
      if (chosen === undefined) return
      const point = pointNear(chosen.box, 0, 0, fx, fy)
      const topmostInside = shapes.filter(({ box: b }) => boxNear(b, point, 0)).at(-1)
      assert.equal(bindingFor(shapes, point, margin)?.target, topmostInside?.id)
    }),
  )
})

void test("a point within the margin outside a shape binds to it at the nearest edge, and a point beyond every margin binds nothing", () => {
  fc.assert(
    fc.property(candidates, offset, offset, (shapes, dx, dy) => {
      const point = pointNear(shapes[0]?.box ?? { x: 0, y: 0, width: 1, height: 1 }, dx, dy, dx < 0 ? 0 : 1, dy < 0 ? 0 : 1)
      const binding = bindingFor(shapes, point, margin)
      const near = shapes.filter(({ box: b }) => boxNear(b, point, margin))
      if (near.length === 0) {
        assert.equal(binding, undefined)
        return
      }
      assert.ok(binding !== undefined && near.some(({ id }) => id === binding.target))
      assert.ok(binding.anchor.x >= 0 && binding.anchor.x <= ANCHOR_SCALE && binding.anchor.y >= 0 && binding.anchor.y <= ANCHOR_SCALE)
    }),
  )
})
