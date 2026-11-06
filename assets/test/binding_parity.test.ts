import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { ANCHOR_SCALE, GEOMETRY } from "../js/generated/manifest.ts"
import { anchorFor, anchorPoint, resolvedShape, type Bindings } from "../js/hooks/binding_logic.ts"
import { absolutePoints, type Box, type Point } from "../js/hooks/canvas_logic.ts"

interface WireArrow extends Box {
  points: Point[]
  start_target_id?: string
  start_anchor_x?: number
  start_anchor_y?: number
  end_target_id?: string
  end_anchor_x?: number
  end_anchor_y?: number
}

interface ResolveCase {
  arrow: WireArrow
  targets: Record<string, Box | null>
  resolved: Box & { points: Point[] }
}

interface AnchorCase {
  box: Box
  point: Point
  anchor: { x: number; y: number }
}

const fixture = JSON.parse(readFileSync(new URL("fixtures/binding_parity.json", import.meta.url), "utf8")) as {
  resolve: ResolveCase[]
  anchor_for: AnchorCase[]
}

const canvas = { width: GEOMETRY.canvasWidth, height: GEOMETRY.canvasHeight }

function bindingsOf(arrow: WireArrow): Bindings {
  const start =
    arrow.start_target_id === undefined ? {} : { start: { target: arrow.start_target_id, anchor: { x: arrow.start_anchor_x ?? 0, y: arrow.start_anchor_y ?? 0 } } }
  const end = arrow.end_target_id === undefined ? {} : { end: { target: arrow.end_target_id, anchor: { x: arrow.end_anchor_x ?? 0, y: arrow.end_anchor_y ?? 0 } } }
  return { ...start, ...end }
}

void test("the client resolves every fixture arrow like the server (ADR 0016, mix sketch.gen.render_fixtures)", () => {
  assert.ok(fixture.resolve.length > 300)
  for (const { arrow, targets, resolved } of fixture.resolve) {
    const { x, y, width, height, points } = arrow
    const shape = resolvedShape({ box: { x, y, width, height }, points }, bindingsOf(arrow), (id) => targets[id] ?? undefined, canvas)
    assert.deepEqual({ ...shape.box, points: shape.points }, resolved, JSON.stringify(arrow))
  }
})

void test("the client takes every fixture anchor like the server", () => {
  for (const { box, point, anchor } of fixture.anchor_for) {
    assert.deepEqual(anchorFor(point, box), anchor, JSON.stringify({ box, point }))
  }
})

const box = fc
  .record({ width: fc.integer({ min: 0, max: 600 }), height: fc.integer({ min: 0, max: 600 }) })
  .chain(({ width, height }) =>
    fc.record({
      x: fc.integer({ min: 0, max: GEOMETRY.canvasWidth - width }),
      y: fc.integer({ min: 0, max: GEOMETRY.canvasHeight - height }),
      width: fc.constant(width),
      height: fc.constant(height),
    }),
  )

void test("a bound end follows its target wherever the target moves, and the other end stays", () => {
  fc.assert(
    fc.property(box, fc.record({ x: fc.nat(ANCHOR_SCALE), y: fc.nat(ANCHOR_SCALE) }), (target, anchor) => {
      const arrow = { box: { x: 10, y: 10, width: 50, height: 50 }, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] }
      const resolved = resolvedShape(arrow, { start: { target: "t", anchor } }, () => target, canvas)
      assert.deepEqual(absolutePoints(resolved), [anchorPoint(target, anchor), { x: 60, y: 60 }])
    }),
    { seed: 1, numRuns: 500 },
  )
})
