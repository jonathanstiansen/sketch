import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { dragPosition, type Point } from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 1000 }

const anyNumber = fc.double({ noNaN: true, noDefaultInfinity: true })
const anyPoint = fc.record({ x: anyNumber, y: anyNumber })
const bounds = fc.record({ x: fc.nat(10_000), y: fc.nat(10_000) })

function within(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max
}

void test("a dragged position is always a whole number within the canvas bounds", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, bounds, (cursor, grab, max) => {
      const { x, y } = dragPosition(cursor, grab, max)
      assert.ok(within(x, max.x) && within(y, max.y), `${String(x)},${String(y)} outside ${JSON.stringify(max)}`)
    }),
    settings,
  )
})

void test("a dragged position is the rounded cursor minus the grab offset whenever that is in bounds", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, bounds, (cursor, grab, max) => {
      const unclamped = { x: Math.round(cursor.x - grab.x), y: Math.round(cursor.y - grab.y) }
      const position = dragPosition(cursor, grab, max)
      if (within(unclamped.x, max.x)) assert.ok(position.x === unclamped.x, `x ${String(position.x)}`)
      if (within(unclamped.y, max.y)) assert.ok(position.y === unclamped.y, `y ${String(position.y)}`)
    }),
    settings,
  )
})

const inBoundsCase = bounds.chain((max) =>
  fc.record({
    max: fc.constant(max),
    target: fc.record(
      { x: fc.integer({ min: 0, max: max.x }), y: fc.integer({ min: 0, max: max.y }) },
      { noNullPrototype: true },
    ),
    grab: fc.record({ x: fc.integer({ min: -1e6, max: 1e6 }), y: fc.integer({ min: -1e6, max: 1e6 }) }),
  }),
)

void test("every in-bounds position, including both edges, is reachable unchanged", () => {
  fc.assert(
    fc.property(inBoundsCase, ({ max, target, grab }) => {
      const cursor: Point = { x: target.x + grab.x, y: target.y + grab.y }
      assert.deepEqual(dragPosition(cursor, grab, max), target)
    }),
    settings,
  )
})
