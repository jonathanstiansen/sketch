import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import {
  ENDPOINTS,
  absolutePoints,
  endpointPoint,
  movedEndpoint,
  shapeAround,
  type Point,
  type Shape,
  type Size,
} from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 1000 }

const canvas: fc.Arbitrary<Size> = fc.record({
  width: fc.integer({ min: 1, max: 5000 }),
  height: fc.integer({ min: 1, max: 5000 }),
})
const anyNumber = fc.double({ min: -20_000, max: 20_000, noNaN: true })
const anyPoint: fc.Arbitrary<Point> = fc.record({ x: anyNumber, y: anyNumber })
const endpoint = fc.constantFrom(...ENDPOINTS)

function clamped({ x, y }: Point, size: Size): Point {
  return {
    x: Math.min(Math.max(Math.round(x), 0), size.width),
    y: Math.min(Math.max(Math.round(y), 0), size.height),
  }
}

function isValidLine({ box, points }: Shape, size: Size): boolean {
  return (
    [box.x, box.y, box.width, box.height].every(Number.isInteger) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width >= 0 &&
    box.height >= 0 &&
    box.x + box.width <= size.width &&
    box.y + box.height <= size.height &&
    points.length === 2 &&
    points.every(
      ({ x, y }) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x <= box.width && y <= box.height,
    )
  )
}

function tightlyBounds({ box, points }: Shape): boolean {
  const xs = points.map(({ x }) => x)
  const ys = points.map(({ y }) => y)
  return Math.min(...xs) === 0 && Math.min(...ys) === 0 && Math.max(...xs) === box.width && Math.max(...ys) === box.height
}

void test("the box around two points is inside the canvas and tightly contains both points", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, canvas, (a, b, size) => {
      const shape = shapeAround([a, b], size)
      assert.ok(isValidLine(shape, size), JSON.stringify(shape))
      assert.ok(tightlyBounds(shape), JSON.stringify(shape))
    }),
    settings,
  )
})

void test("relative points round-trip to the clamped canvas points they were drawn from", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, canvas, (a, b, size) => {
      assert.deepEqual(absolutePoints(shapeAround([a, b], size)), [clamped(a, size), clamped(b, size)])
    }),
    settings,
  )
})

void test("moving an endpoint puts it at the clamped pointer and leaves the other endpoint where it was", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, anyPoint, endpoint, canvas, (a, b, pointer, moved, size) => {
      const line = shapeAround([a, b], size)
      const edited = movedEndpoint(line, moved, pointer, size)
      const kept = moved === "start" ? "end" : "start"

      assert.ok(isValidLine(edited, size), JSON.stringify(edited))
      assert.ok(tightlyBounds(edited), JSON.stringify(edited))
      assert.deepEqual(endpointPoint(edited, moved), clamped(pointer, size))
      assert.deepEqual(endpointPoint(edited, kept), endpointPoint(line, kept))
    }),
    settings,
  )
})
