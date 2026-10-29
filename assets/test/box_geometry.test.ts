import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import {
  CORNERS,
  MIN_SIZE,
  clickBox,
  cornerPoint,
  drawnBox,
  movedBox,
  resizedBox,
  type Box,
  type Corner,
  type Point,
  type Size,
} from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 1000 }

const canvas: fc.Arbitrary<Size> = fc.record({
  width: fc.integer({ min: 1, max: 5000 }),
  height: fc.integer({ min: 1, max: 5000 }),
})
const anyNumber = fc.double({ min: -20_000, max: 20_000, noNaN: true })
const anyPoint: fc.Arbitrary<Point> = fc.record({ x: anyNumber, y: anyNumber })
const corner = fc.constantFrom(...CORNERS)

const oppositeOf: Record<Corner, Corner> = { nw: "se", ne: "sw", sw: "ne", se: "nw" }

function insideCanvas(size: Size): fc.Arbitrary<Point> {
  return fc.record({ x: fc.integer({ min: 0, max: size.width }), y: fc.integer({ min: 0, max: size.height }) })
}

function boxInside(size: Size): fc.Arbitrary<Box> {
  return fc
    .record({ width: fc.integer({ min: 1, max: size.width }), height: fc.integer({ min: 1, max: size.height }) })
    .chain(({ width, height }) =>
      fc.record({
        x: fc.integer({ min: 0, max: size.width - width }),
        y: fc.integer({ min: 0, max: size.height - height }),
        width: fc.constant(width),
        height: fc.constant(height),
      }, { noNullPrototype: true }),
    )
}

function isInside(box: Box, size: Size): boolean {
  return (
    [box.x, box.y, box.width, box.height].every(Number.isInteger) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width >= MIN_SIZE &&
    box.height >= MIN_SIZE &&
    box.x + box.width <= size.width &&
    box.y + box.height <= size.height
  )
}

function unclampedBox(a: Point, b: Point): Box {
  const [ax, ay, bx, by] = [Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)]
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
}

function describe(box: Box): string {
  return JSON.stringify(box)
}

void test("a drawn box is always whole, at least 1 x 1 and inside the canvas", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, canvas, (start, end, size) => {
      const box = drawnBox(start, end, size)
      assert.ok(isInside(box, size), `${describe(box)} outside ${JSON.stringify(size)}`)
    }),
    settings,
  )
})

void test("a drawn box equals the rounded drag rectangle whenever that is inside the canvas", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, canvas, (start, end, size) => {
      const expected = unclampedBox(start, end)
      if (isInside(expected, size)) assert.deepEqual(drawnBox(start, end, size), expected)
    }),
    settings,
  )
})

void test("every box inside the canvas can be drawn exactly, from any of its four corners", () => {
  fc.assert(
    fc.property(
      canvas.chain((size) => fc.tuple(fc.constant(size), boxInside(size), corner)),
      ([size, box, from]) => {
        const start = cornerPoint(box, from)
        const opposite = { x: 2 * box.x + box.width - start.x, y: 2 * box.y + box.height - start.y }
        assert.deepEqual(drawnBox(start, opposite, size), box)
      },
    ),
    settings,
  )
})

void test("a drawn box does not depend on the drag direction", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, canvas, (start, end, size) => {
      assert.deepEqual(drawnBox(start, end, size), drawnBox(end, start, size))
    }),
    settings,
  )
})

void test("a resized box is always whole, at least 1 x 1 and inside the canvas", () => {
  fc.assert(
    fc.property(
      canvas.chain((size) => fc.tuple(fc.constant(size), boxInside(size), corner, anyPoint)),
      ([size, box, dragged, pointer]) => {
        const resized = resizedBox(box, dragged, pointer, size)
        assert.ok(isInside(resized, size), `${describe(resized)} outside ${JSON.stringify(size)}`)
      },
    ),
    settings,
  )
})

void test("resizing keeps the opposite corner and follows the pointer whenever the result fits", () => {
  fc.assert(
    fc.property(
      canvas.chain((size) => fc.tuple(fc.constant(size), boxInside(size), corner, insideCanvas(size))),
      ([size, box, dragged, pointer]) => {
        const opposite = cornerPoint(box, oppositeOf[dragged])
        const expected = unclampedBox(opposite, pointer)
        if (isInside(expected, size)) assert.deepEqual(resizedBox(box, dragged, pointer, size), expected)
      },
    ),
    settings,
  )
})

void test("dropping a corner where it started leaves the box unchanged", () => {
  fc.assert(
    fc.property(
      canvas.chain((size) => fc.tuple(fc.constant(size), boxInside(size), corner)),
      ([size, box, dragged]) => {
        assert.deepEqual(resizedBox(box, dragged, cornerPoint(box, dragged), size), box)
      },
    ),
    settings,
  )
})

void test("a click box has the default size where it fits and always lies inside the canvas", () => {
  fc.assert(
    fc.property(anyPoint, canvas, (point, size) => {
      const box = clickBox(point, { width: 120, height: 80 }, size)
      assert.ok(isInside(box, size), describe(box))
      assert.deepEqual([box.width, box.height], [Math.min(120, size.width), Math.min(80, size.height)])
    }),
    settings,
  )
})

void test("a moved box keeps its size and stays inside the canvas", () => {
  fc.assert(
    fc.property(
      canvas.chain((size) => fc.tuple(fc.constant(size), boxInside(size), anyPoint, anyPoint)),
      ([size, box, cursor, grab]) => {
        const moved = movedBox(box, cursor, grab, size)
        assert.ok(isInside(moved, size), describe(moved))
        assert.deepEqual([moved.width, moved.height], [box.width, box.height])
      },
    ),
    settings,
  )
})
