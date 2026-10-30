import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { isDrag, type Box, type Size } from "../js/hooks/canvas_logic.ts"
import {
  FIT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  anchoredScroll,
  canvasUnderAnchor,
  clampScroll,
  clampZoom,
  fitView,
  screenToCanvas,
  stepZoom,
  visibleCanvas,
  wheelZoom,
  zoomActionFor,
  type ZoomKeyInput,
} from "../js/hooks/zoom_logic.ts"

const settings = { seed: 1, numRuns: 1000 }
const canvas: Size = { width: 4000, height: 4000 }

const zoomArb = fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true })
const pointArb = fc.record({ x: fc.double({ min: 0, max: 2000, noNaN: true }), y: fc.double({ min: 0, max: 2000, noNaN: true }) })
const viewportArb = fc.record({ width: fc.integer({ min: 400, max: 2400 }), height: fc.integer({ min: 400, max: 1600 }) })
const boxArb: fc.Arbitrary<Box> = fc
  .record({ x: fc.integer({ min: 0, max: 3999 }), y: fc.integer({ min: 0, max: 3999 }), width: fc.integer({ min: 1, max: 4000 }), height: fc.integer({ min: 1, max: 4000 }) })
  .map(({ x, y, width, height }) => ({ x, y, width: Math.min(width, 4000 - x), height: Math.min(height, 4000 - y) }))

function press(key: string, modifiers: Partial<ZoomKeyInput> = {}): ZoomKeyInput {
  return { key, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, editable: false, ...modifiers }
}

void test("zoom is clamped to 10%..400%", () => {
  assert.equal(clampZoom(0.01), MIN_ZOOM)
  assert.equal(clampZoom(40), MAX_ZOOM)
  fc.assert(
    fc.property(fc.double({ noNaN: true }), (zoom) => {
      const clamped = clampZoom(zoom)
      assert.ok(clamped >= MIN_ZOOM && clamped <= MAX_ZOOM)
    }),
    settings,
  )
})

void test("stepping moves to the next level and stops at the ends", () => {
  assert.equal(stepZoom(1, "in"), 1.5)
  assert.equal(stepZoom(1, "out"), 0.75)
  assert.equal(stepZoom(MAX_ZOOM, "in"), MAX_ZOOM)
  assert.equal(stepZoom(MIN_ZOOM, "out"), MIN_ZOOM)
  fc.assert(
    fc.property(zoomArb, fc.constantFrom("in" as const, "out" as const), (zoom, direction) => {
      const next = stepZoom(zoom, direction)
      assert.ok(next >= MIN_ZOOM && next <= MAX_ZOOM)
      assert.ok(direction === "in" ? next >= zoom - 1e-9 : next <= zoom + 1e-9)
      assert.ok(ZOOM_LEVELS.includes(next) || next === clampZoom(zoom))
    }),
    settings,
  )
})

void test("repeated steps visit every level in order", () => {
  const visited = [MIN_ZOOM]
  for (let step = 0; step < ZOOM_LEVELS.length - 1; step += 1) visited.push(stepZoom(visited[visited.length - 1] ?? MIN_ZOOM, "in"))
  assert.deepEqual(visited, [...ZOOM_LEVELS])
})

void test("the wheel zooms in for negative deltas, out for positive ones, and stays in range", () => {
  assert.ok(wheelZoom(1, -10) > 1)
  assert.ok(wheelZoom(1, 10) < 1)
  fc.assert(
    fc.property(zoomArb, fc.double({ min: -10000, max: 10000, noNaN: true }), (zoom, delta) => {
      const next = wheelZoom(zoom, delta)
      assert.ok(next >= MIN_ZOOM && next <= MAX_ZOOM)
    }),
    settings,
  )
})

void test("for any zoom change the canvas point under the anchor is unchanged within 0.5 px", () => {
  fc.assert(
    fc.property(pointArb, pointArb, zoomArb, zoomArb, (scroll, anchor, from, to) => {
      const before = canvasUnderAnchor(scroll, anchor, from)
      const after = canvasUnderAnchor(anchoredScroll(scroll, anchor, from, to), anchor, to)
      assert.ok(Math.abs(after.x - before.x) <= 0.5)
      assert.ok(Math.abs(after.y - before.y) <= 0.5)
    }),
    settings,
  )
})

void test("the anchor stays fixed after clamping whenever the scroll range allows it", () => {
  const viewport = { width: 1000, height: 700 }
  fc.assert(
    fc.property(pointArb, pointArb, zoomArb, zoomArb, (scroll, anchor, from, to) => {
      const wanted = anchoredScroll(scroll, anchor, from, to)
      const clamped = clampScroll(wanted, canvas, to, viewport)
      const before = canvasUnderAnchor(scroll, anchor, from)
      const after = canvasUnderAnchor(clamped, anchor, to)
      if (clamped.x === wanted.x) assert.ok(Math.abs(after.x - before.x) <= 0.5)
      if (clamped.y === wanted.y) assert.ok(Math.abs(after.y - before.y) <= 0.5)
    }),
    settings,
  )
})

void test("clamped scroll stays inside the zoomed canvas", () => {
  fc.assert(
    fc.property(fc.record({ x: fc.double({ min: -1e4, max: 1e4, noNaN: true }), y: fc.double({ min: -1e4, max: 1e4, noNaN: true }) }), zoomArb, viewportArb, (scroll, zoom, viewport) => {
      const clamped = clampScroll(scroll, canvas, zoom, viewport)
      assert.ok(clamped.x >= 0 && clamped.x <= Math.max(canvas.width * zoom - viewport.width, 0))
      assert.ok(clamped.y >= 0 && clamped.y <= Math.max(canvas.height * zoom - viewport.height, 0))
    }),
    settings,
  )
})

void test("screen points convert to canvas points at any zoom, and back", () => {
  assert.deepEqual(screenToCanvas({ x: 300, y: 150 }, { x: 100, y: 50 }, 2), { x: 100, y: 50 })
  assert.deepEqual(screenToCanvas({ x: 100, y: 60 }, { x: 0, y: 0 }, 0.5), { x: 200, y: 120 })
  fc.assert(
    fc.property(pointArb, pointArb, zoomArb, (client, origin, zoom) => {
      const at = screenToCanvas(client, origin, zoom)
      assert.ok(Math.abs(at.x * zoom + origin.x - client.x) < 1e-6)
      assert.ok(Math.abs(at.y * zoom + origin.y - client.y) < 1e-6)
    }),
    settings,
  )
})

void test("fit always contains every box, with padding, whenever the zoom range allows it", () => {
  fc.assert(
    fc.property(fc.array(boxArb, { minLength: 1, maxLength: 12 }), viewportArb, (boxes, viewport) => {
      const view = fitView(boxes, canvas, viewport)
      const visible = visibleCanvas(view, viewport)
      assert.ok(view.zoom >= MIN_ZOOM && view.zoom <= MAX_ZOOM)
      for (const box of boxes) {
        assert.ok(box.x >= visible.x - 1e-6, "left edge")
        assert.ok(box.y >= visible.y - 1e-6, "top edge")
        assert.ok(box.x + box.width <= visible.x + visible.width + 1e-6, "right edge")
        assert.ok(box.y + box.height <= visible.y + visible.height + 1e-6, "bottom edge")
      }
    }),
    settings,
  )
})

void test("fit leaves the padding around the content when the content is not clamped by the canvas", () => {
  const view = fitView([{ x: 1000, y: 1000, width: 200, height: 100 }], canvas, { width: 800, height: 600 })
  const visible = visibleCanvas(view, { width: 800, height: 600 })
  assert.ok(visible.x <= 1000 - FIT_PADDING + 1e-6)
  assert.ok(visible.x + visible.width >= 1200 + FIT_PADDING - 1e-6)
})

void test("an empty board fits to 100%", () => {
  assert.deepEqual(fitView([], canvas, { width: 800, height: 600 }), { zoom: 1, scroll: { x: 0, y: 0 } })
})

void test("zoom chords: Ctrl or Command with =, + or - or 0, and Shift+1 by key position", () => {
  assert.equal(zoomActionFor(press("=", { ctrlKey: true })), "zoom_in")
  assert.equal(zoomActionFor(press("+", { metaKey: true, shiftKey: true })), "zoom_in")
  assert.equal(zoomActionFor(press("-", { ctrlKey: true })), "zoom_out")
  assert.equal(zoomActionFor(press("0", { metaKey: true })), "zoom_reset")
  assert.equal(zoomActionFor(press("!", { code: "Digit1", shiftKey: true })), "zoom_fit")
  assert.equal(zoomActionFor(press("=")), undefined)
  assert.equal(zoomActionFor(press("0")), undefined)
  assert.equal(zoomActionFor(press("1", { code: "Digit1" })), undefined)
  assert.equal(zoomActionFor(press("=", { ctrlKey: true, altKey: true })), undefined)
  assert.equal(zoomActionFor(press("!", { code: "Digit1", shiftKey: true, ctrlKey: true })), undefined)
})

void test("while an editor has focus only the Ctrl or Command chords still zoom", () => {
  assert.equal(zoomActionFor(press("!", { code: "Digit1", shiftKey: true, editable: true })), undefined)
  assert.equal(zoomActionFor(press("=", { ctrlKey: true, editable: true })), "zoom_in")
})

void test("the drag threshold is in screen pixels", () => {
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 2, y: 0 }), false)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 3, y: 0 }), true)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 4), false)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 0.75, y: 0 }, 4), true)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 5, y: 0 }, 0.5), false)
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 6, y: 0 }, 0.5), true)
})
