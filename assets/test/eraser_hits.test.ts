import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { eraserHits, segmentHitsBox, type Box, type Hittable, type Point } from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 1000 }

const coordinate = fc.integer({ min: -20, max: 220 })
const point: fc.Arbitrary<Point> = fc.record({ x: coordinate, y: coordinate })
const box: fc.Arbitrary<Box> = fc.record({
  x: fc.integer({ min: 0, max: 200 }),
  y: fc.integer({ min: 0, max: 200 }),
  width: fc.integer({ min: 0, max: 60 }),
  height: fc.integer({ min: 0, max: 60 }),
})
const elements: fc.Arbitrary<Hittable[]> = fc
  .array(box, { maxLength: 8 })
  .map((boxes) => boxes.map((at, index) => ({ id: `element-${String(index)}`, box: at })))
const path = fc.array(point, { minLength: 1, maxLength: 6 })

function inside(at: Point, { x, y, width, height }: Box): boolean {
  return at.x >= x && at.x <= x + width && at.y >= y && at.y <= y + height
}

function orientation(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y)
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const [o1, o2, o3, o4] = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)]
  if (o1 !== o2 && o3 !== o4) return true
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  )
}

function corners({ x, y, width, height }: Box): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]
}

function touches(from: Point, to: Point, target: Box): boolean {
  if (inside(from, target) || inside(to, target)) return true
  const edges = corners(target)
  return edges.some((corner, index) => segmentsCross(from, to, corner, edges[(index + 1) % 4] ?? corner))
}

function expectedHits(targets: Hittable[], walked: Point[]): string[] {
  const segments = walked.length === 1 ? [[walked[0], walked[0]]] : walked.slice(1).map((to, index) => [walked[index], to])
  return targets
    .filter(({ box: target }) =>
      segments.some(([from, to]) => from !== undefined && to !== undefined && touches(from, to, target)),
    )
    .map(({ id }) => id)
}

void test("the eraser hits exactly the elements whose bounding box the path touches, in element order", () => {
  fc.assert(
    fc.property(elements, path, (targets, walked) => {
      assert.deepEqual(eraserHits(targets, walked), expectedHits(targets, walked))
    }),
    settings,
  )
})

void test("a click hits exactly the boxes containing the point, edges included", () => {
  fc.assert(
    fc.property(elements, point, (targets, at) => {
      const hit = targets.filter(({ box: target }) => inside(at, target)).map(({ id }) => id)
      assert.deepEqual(eraserHits(targets, [at]), hit)
    }),
    settings,
  )
})

void test("a segment's hit does not depend on its direction, and a longer path never hits fewer elements", () => {
  fc.assert(
    fc.property(elements, path, point, (targets, walked, next) => {
      for (const { box: target } of targets) {
        const [from] = walked
        if (from !== undefined) assert.equal(segmentHitsBox(from, next, target), segmentHitsBox(next, from, target))
      }
      const before = new Set(eraserHits(targets, walked))
      const after = new Set(eraserHits(targets, [...walked, next]))
      assert.ok([...before].every((id) => after.has(id)))
    }),
    settings,
  )
})

void test("a segment crossing a zero-width line's box hits it, and one passing beside it does not", () => {
  const line: Hittable = { id: "line", box: { x: 50, y: 0, width: 0, height: 100 } }
  assert.deepEqual(eraserHits([line], [{ x: 0, y: 50 }, { x: 100, y: 50 }]), ["line"])
  assert.deepEqual(eraserHits([line], [{ x: 0, y: 150 }, { x: 100, y: 150 }]), [])
  assert.deepEqual(eraserHits([line], [{ x: 49.5, y: 0 }, { x: 49.5, y: 100 }]), [])
})
