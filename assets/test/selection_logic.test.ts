import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { anyStyle } from "./style_arbitrary.ts"
import { RemotePreviews, type Box, type Point, type Shape } from "../js/hooks/canvas_logic.ts"
import {
  EMPTY_SELECTION,
  acceptedGroupEntries,
  erasedWithSelection,
  groupPreview,
  intersects,
  marqueeBox,
  marqueeHits,
  marqueeSelection,
  movedGroup,
  propertyState,
  restyleTargets,
  selectionAttribute,
  selectionFromAttribute,
  selectsAll,
  toggled,
  united,
  type GroupPreview,
} from "../js/hooks/selection_logic.ts"
import { DEFAULT_STYLE, appliesTo, isStyleToken, styleForKind } from "../js/elements/style.ts"
import { ELEMENT_KINDS, GEOMETRY, STYLE_PROPERTIES, STYLE_TOKENS, type ElementKind } from "../js/generated/manifest.ts"
import { anyModifiers, press } from "./key_press.ts"

const settings = { seed: 1, numRuns: 500 }
const canvas = { width: GEOMETRY.canvasWidth, height: GEOMETRY.canvasHeight }

const point = fc.record({ x: fc.integer({ min: -200, max: 4200 }), y: fc.integer({ min: -200, max: 4200 }) })

const box: fc.Arbitrary<Box> = fc
  .record({ x: fc.nat(3990), y: fc.nat(3990), width: fc.nat(400), height: fc.nat(400) })
  .map(({ x, y, width, height }) => ({ x, y, width: Math.min(width, canvas.width - x), height: Math.min(height, canvas.height - y) }))

const ids = ["a", "b", "c", "d", "e", "f"] as const
const id = fc.constantFrom(...ids)
const selection = fc.uniqueArray(id, { maxLength: ids.length })

const elements = fc.uniqueArray(fc.record({ id, box }), { selector: (element) => element.id, maxLength: ids.length })

function corners({ x, y, width, height }: Box): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ]
}

function inside(p: Point, { x, y, width, height }: Box): boolean {
  return p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height
}

void test("toggling adds an unselected element, removes a selected one, and twice is the identity", () => {
  fc.assert(
    fc.property(selection, id, (selected, toggledId) => {
      const once = toggled(selected, toggledId)
      assert.equal(once.includes(toggledId), !selected.includes(toggledId))
      assert.deepEqual(new Set(toggled(once, toggledId)), new Set(selected))
      assert.equal(new Set(once).size, once.length)
    }),
    settings,
  )
})

void test("a marquee is the same box whichever corner it starts from and selects exactly the boxes it touches", () => {
  fc.assert(
    fc.property(elements, point, point, (shapes, start, end) => {
      const marquee = marqueeBox(start, end)
      assert.deepEqual(marquee, marqueeBox(end, start))
      assert.ok(inside(start, marquee) && inside(end, marquee))
      const hits = marqueeHits(shapes, marquee)
      for (const shape of shapes) {
        const touches = intersects(shape.box, marquee)
        assert.equal(hits.includes(shape.id), touches)
        if (corners(shape.box).some((corner) => inside(corner, marquee))) assert.ok(touches)
        if (corners(marquee).some((corner) => inside(corner, shape.box))) assert.ok(touches)
        const apart =
          shape.box.x + shape.box.width < marquee.x ||
          marquee.x + marquee.width < shape.box.x ||
          shape.box.y + shape.box.height < marquee.y ||
          marquee.y + marquee.height < shape.box.y
        assert.equal(touches, !apart)
      }
    }),
    settings,
  )
})

void test("a marquee replaces the selection, and with Shift adds to it without duplicates", () => {
  fc.assert(
    fc.property(selection, selection, (current, hits) => {
      assert.deepEqual(new Set(marqueeSelection(current, hits, false)), new Set(hits))
      const added = marqueeSelection(current, hits, true)
      assert.deepEqual(new Set(added), new Set([...current, ...hits]))
      assert.equal(new Set(added).size, added.length)
      assert.deepEqual(added.slice(0, current.length), [...current])
    }),
    settings,
  )
})

const shape: fc.Arbitrary<Shape> = box.chain((b) =>
  fc.array(fc.record({ x: fc.nat(b.width), y: fc.nat(b.height) }), { maxLength: 3 }).map((points) => ({ box: b, points })),
)

void test("a group move clamps the delta, so every element stays inside the canvas and keeps its relative position", () => {
  fc.assert(
    fc.property(fc.array(shape, { minLength: 1, maxLength: 6 }), point, (origins, wanted) => {
      const { delta, shapes } = movedGroup(origins, wanted, canvas)
      shapes.forEach((moved, index) => {
        const origin = origins[index]
        assert.ok(origin !== undefined)
        assert.deepEqual(moved.points, origin.points)
        assert.equal(moved.box.x - origin.box.x, delta.x)
        assert.equal(moved.box.y - origin.box.y, delta.y)
        assert.equal(moved.box.width, origin.box.width)
        assert.ok(moved.box.x >= 0 && moved.box.y >= 0)
        assert.ok(moved.box.x + moved.box.width <= canvas.width && moved.box.y + moved.box.height <= canvas.height)
      })
      assert.ok(Math.abs(delta.x) <= Math.abs(Math.round(wanted.x)) && Math.abs(delta.y) <= Math.abs(Math.round(wanted.y)))
    }),
    settings,
  )
})

void test("a group move that fits is not clamped at all", () => {
  const origins = [
    { box: { x: 100, y: 100, width: 50, height: 50 }, points: [] },
    { box: { x: 300, y: 200, width: 0, height: 40 }, points: [{ x: 0, y: 0 }, { x: 0, y: 40 }] },
  ]
  assert.deepEqual(movedGroup(origins, { x: -100, y: 30 }, canvas).delta, { x: -100, y: 30 })
  assert.deepEqual(movedGroup(origins, { x: -150, y: 30 }, canvas).delta, { x: -100, y: 30 })
  assert.deepEqual(
    movedGroup(origins, { x: -150, y: 30 }, canvas).shapes.map(({ box: { x } }) => x),
    [0, 200],
  )
})

interface Drag {
  dragId: string
  base: Record<string, number>
  members: readonly string[]
  moves: number
}

const known: Record<string, number> = { a: 3, b: 5, c: 0 }
const members = ["a", "b", "c"] as const

const drag: fc.Arbitrary<Drag> = fc.record({
  dragId: fc.constantFrom("g1", "g2", "g3"),
  base: fc.record({ a: fc.integer({ min: 1, max: 4 }), b: fc.integer({ min: 4, max: 6 }), c: fc.constant(0) }),
  members: fc.uniqueArray(fc.constantFrom(...members), { minLength: 1 }),
  moves: fc.integer({ min: 1, max: 5 }),
})

function previewsOf({ dragId, base, members: ids, moves }: Drag): GroupPreview[] {
  return Array.from({ length: moves }, (_, index) =>
    groupPreview(
      dragId,
      index + 1,
      ids.map((elementId) => ({ elementId, baseVersion: base[elementId] ?? 0, shape: { box: { x: index, y: 0, width: 10, height: 10 }, points: [] } })),
    ),
  )
}

const deliveries = fc
  .uniqueArray(drag, { selector: (d) => d.dragId, minLength: 1, maxLength: 3 })
  .chain((drags) => {
    const previews = drags.flatMap(previewsOf)
    return fc.tuple(fc.shuffledSubarray(previews, { minLength: previews.length }), fc.nat())
  })

function modelAccepts(group: GroupPreview, latest: Map<string, number>, erased: ReadonlySet<string>): string[] {
  return group.elements.flatMap((entry) => {
    const key = `${entry.element_id}/${group.drag_id}`
    const current = known[entry.element_id] ?? 0
    if (erased.has(entry.element_id) || entry.base_version < current || group.seq <= (latest.get(key) ?? 0)) return []
    latest.set(key, group.seq)
    return [entry.element_id]
  })
}

void test("a batched group preview applies the single-preview rules to each element: base version, newer seq per drag, erase", () => {
  fc.assert(
    fc.property(deliveries, ([delivered, cut]) => {
      const eraseAt = cut % (delivered.length + 1)
      const previews = new RemotePreviews()
      const latest = new Map<string, number>()
      const erased = new Set<string>()
      delivered.forEach((group, index) => {
        if (index === eraseAt) {
          previews.erase("b")
          erased.add("b")
        }
        const accepted = acceptedGroupEntries(previews, group, (elementId) => known[elementId]).map(({ element_id }) => element_id)
        assert.deepEqual(accepted, modelAccepts(group, latest, erased))
      })
    }),
    settings,
  )
})

void test("an element no longer on the board, or being edited here, takes nothing from a group preview", () => {
  const previews = new RemotePreviews()
  const group = groupPreview("g", 1, [
    { elementId: "a", baseVersion: 3, shape: { box: { x: 1, y: 1, width: 1, height: 1 }, points: [] } },
    { elementId: "gone", baseVersion: 0, shape: { box: { x: 1, y: 1, width: 1, height: 1 }, points: [] } },
  ])
  assert.deepEqual(
    acceptedGroupEntries(previews, group, (elementId) => known[elementId]).map(({ element_id }) => element_id),
    ["a"],
  )
})

void test("cancelling one element of a group drag leaves the other elements' previews flowing", () => {
  const previews = new RemotePreviews()
  const at = (seq: number): GroupPreview =>
    groupPreview(
      "g",
      seq,
      ["a", "b"].map((elementId) => ({ elementId, baseVersion: 5, shape: { box: { x: seq, y: 0, width: 1, height: 1 }, points: [] } })),
    )
  assert.equal(acceptedGroupEntries(previews, at(1), () => 5).length, 2)
  assert.equal(previews.finish({ element_id: "a", drag_id: "g" }), true)
  assert.deepEqual(
    acceptedGroupEntries(previews, at(2), () => 5).map(({ element_id }) => element_id),
    ["b"],
  )
})

const style = anyStyle

const kind: fc.Arbitrary<ElementKind> = fc.constantFrom(...ELEMENT_KINDS)
const styled = fc.array(fc.record({ id, kind, style }).map((element) => ({ ...element, style: styleForKind(element.kind, element.style) })), {
  maxLength: 6,
})

void test("the style panel shows a property when it applies to a selected kind, its value when all agree, and mixed otherwise", () => {
  fc.assert(
    fc.property(styled, (selected) => {
      for (const property of STYLE_PROPERTIES) {
        const values = new Set(selected.filter(({ kind: k }) => appliesTo(k, property)).map(({ style: s }) => s[property]))
        const state = propertyState(selected, property)
        assert.equal(state.applies, values.size > 0)
        assert.equal(state.mixed, values.size > 1)
        assert.equal(state.value, values.size === 1 ? [...values][0] : undefined)
      }
    }),
    settings,
  )
})

void test("a group restyle commits once per selected element the property applies to and whose value differs", () => {
  fc.assert(
    fc.property(styled, fc.constantFrom(...STYLE_PROPERTIES), fc.nat(), (selected, property, pick) => {
      const tokens: readonly string[] = STYLE_TOKENS[property]
      const value = tokens[pick % tokens.length] ?? DEFAULT_STYLE[property]
      const targets = restyleTargets(selected, property, value)
      const expected = selected.filter(({ kind: k, style: s }) => appliesTo(k, property) && s[property] !== value)
      assert.deepEqual(
        targets,
        expected.map(({ id: elementId, style: s }) => ({ id: elementId, before: s[property] })),
      )
      for (const { before } of targets) assert.ok(isStyleToken(property, before))
    }),
    settings,
  )
})

void test("an eraser stroke that touches a selected element erases the whole selection, and otherwise only what it touches", () => {
  fc.assert(
    fc.property(selection, selection, (hits, selected) => {
      const erased = erasedWithSelection(hits, selected)
      const touchesSelection = hits.some((hit) => selected.includes(hit))
      assert.deepEqual(new Set(erased), new Set(touchesSelection ? [...hits, ...selected] : hits))
    }),
    settings,
  )
})

void test("united keeps order and drops duplicates", () => {
  assert.deepEqual(united(["a", "b"], ["b", "c", "a"]), ["a", "b", "c"])
  assert.deepEqual(united(EMPTY_SELECTION, []), [])
})

void test("Ctrl/⌘+A selects all on the canvas only, with exactly those modifiers", () => {
  assert.equal(selectsAll({ ...press("KeyA", { ctrlKey: true }), editable: false }), true)
  assert.equal(selectsAll({ ...press("KeyA", { metaKey: true }), editable: false }), true)
  assert.equal(selectsAll({ ...press("KeyA", { ctrlKey: true }), editable: true }), false)
  assert.equal(selectsAll({ ...press("KeyA"), editable: false }), false)
  fc.assert(
    fc.property(anyModifiers, (modifiers) => {
      const exact = (modifiers.ctrlKey || modifiers.metaKey) && !modifiers.shiftKey && !modifiers.altKey
      assert.equal(selectsAll({ ...press("KeyA", modifiers), editable: false }), exact)
    }),
    settings,
  )
})

void test("the selection published on the viewport reads back as the same ids (export, clipboard)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.uuid(), { maxLength: 20 }), (ids) => {
      const published = selectionAttribute(ids)
      assert.deepEqual(selectionFromAttribute(published ?? null), ids)
      assert.equal(published === undefined, ids.length === 0)
    }),
    { seed: 1, numRuns: 500 },
  )
})
