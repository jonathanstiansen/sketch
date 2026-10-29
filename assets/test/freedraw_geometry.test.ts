import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { scalePoints, thinStroke, type Point, type Size } from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 1000 }
const minDistance = 4
const hugeMax = 100_000

const coordinate = fc.integer({ min: 0, max: 400 })
const point: fc.Arbitrary<Point> = fc.record({ x: coordinate, y: coordinate })
const stroke = fc.array(point, { minLength: 2, maxLength: 300 })
const maxPoints = fc.integer({ min: 2, max: 40 })

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

void test("thinning keeps the first and last points", () => {
  fc.assert(
    fc.property(stroke, maxPoints, (points, max) => {
      const thinned = thinStroke(points, minDistance, max)
      assert.deepEqual(thinned[0], points[0])
      assert.deepEqual(thinned.at(-1), points.at(-1))
    }),
    settings,
  )
})

void test("thinning never exceeds the maximum and keeps at least two points", () => {
  fc.assert(
    fc.property(stroke, maxPoints, (points, max) => {
      const thinned = thinStroke(points, minDistance, max)
      assert.ok(thinned.length <= max)
      assert.ok(thinned.length >= 2)
    }),
    settings,
  )
})

void test("thinning leaves every original point within the distance of a kept point", () => {
  fc.assert(
    fc.property(stroke, (points) => {
      const thinned = thinStroke(points, minDistance, hugeMax)
      for (const original of points) {
        assert.ok(thinned.some((kept) => distance(kept, original) < minDistance))
      }
    }),
    settings,
  )
})

void test("thinning is idempotent", () => {
  fc.assert(
    fc.property(stroke, maxPoints, (points, max) => {
      const once = thinStroke(points, minDistance, max)
      assert.deepEqual(thinStroke(once, minDistance, max), once)
    }),
    settings,
  )
})

void test("thinning keeps a lone point", () => {
  fc.assert(
    fc.property(point, (only) => {
      assert.deepEqual(thinStroke([only], minDistance, 5), [only])
    }),
    settings,
  )
})

const size: fc.Arbitrary<Size> = fc.record({
  width: fc.integer({ min: 0, max: 4000 }),
  height: fc.integer({ min: 0, max: 4000 }),
})

const pointsInside = size.chain((from) =>
  fc.record({
    from: fc.constant(from),
    points: fc.array(
      fc.record({ x: fc.integer({ min: 0, max: from.width }), y: fc.integer({ min: 0, max: from.height }) }),
      { minLength: 2, maxLength: 50 },
    ),
  }),
)

void test("scalePoints keeps the points inside the new box", () => {
  fc.assert(
    fc.property(pointsInside, size, ({ from, points }, to) => {
      const scaled = scalePoints(points, from, to)
      assert.equal(scaled.length, points.length)
      for (const { x, y } of scaled) {
        assert.ok(Number.isInteger(x) && Number.isInteger(y))
        assert.ok(x >= 0 && x <= to.width && y >= 0 && y <= to.height)
      }
    }),
    settings,
  )
})

void test("scalePoints round-trips for an identity scale", () => {
  fc.assert(
    fc.property(pointsInside, ({ from, points }) => {
      assert.deepEqual(
        scalePoints(points, from, from),
        points.map(({ x, y }) => ({ x, y })),
      )
    }),
    settings,
  )
})
