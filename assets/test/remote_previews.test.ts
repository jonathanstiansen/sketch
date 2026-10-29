import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { RemotePreviews, type Box, type Preview } from "../js/hooks/canvas_logic.ts"

const settings = { seed: 1, numRuns: 500 }
const elementId = "element-1"
const knownVersion = 5
const committed: Box = { x: 100, y: 100, width: 120, height: 80 }

class Viewer {
  readonly previews = new RemotePreviews()
  readonly applied: Preview[] = []
  shown: Box = committed

  receive(preview: Preview): void {
    if (!this.previews.accept(preview, knownVersion)) return
    this.applied.push(preview)
    this.shown = { x: preview.x, y: preview.y, width: preview.width, height: preview.height }
  }

  cancel(dragId: string): void {
    if (this.previews.finish({ element_id: elementId, drag_id: dragId })) this.shown = committed
  }
}

const box = fc.record({ x: fc.nat(3880), y: fc.nat(3920), width: fc.integer({ min: 1, max: 120 }), height: fc.integer({ min: 1, max: 80 }) })

interface Drag {
  dragId: string
  baseVersion: number
  positions: Box[]
}

const drag: fc.Arbitrary<Drag> = fc.record({
  dragId: fc.constantFrom("drag-a", "drag-b", "drag-c", "drag-d"),
  baseVersion: fc.integer({ min: knownVersion - 2, max: knownVersion + 1 }),
  positions: fc.array(box, { minLength: 1, maxLength: 8 }),
})

function previewsOf({ dragId, baseVersion, positions }: Drag): Preview[] {
  return positions.map((position, index) => ({
    element_id: elementId,
    drag_id: dragId,
    seq: index + 1,
    base_version: baseVersion,
    ...position,
    points: [],
  }))
}

const delivery = fc
  .uniqueArray(drag, { selector: (d) => d.dragId, minLength: 1, maxLength: 4 })
  .chain((drags) => {
    const previews = drags.flatMap(previewsOf)
    return fc.shuffledSubarray(previews, { minLength: previews.length })
  })

function current(previews: Preview[]): Preview[] {
  return previews.filter((p) => p.base_version >= knownVersion)
}

function highestSeqPerDrag(previews: Preview[]): Map<string, Preview> {
  const highest = new Map<string, Preview>()
  for (const p of current(previews)) {
    if ((highest.get(p.drag_id)?.seq ?? 0) < p.seq) highest.set(p.drag_id, p)
  }
  return highest
}

function lastAppliedPerDrag(applied: Preview[]): Map<string, Preview> {
  return new Map(applied.map((p) => [p.drag_id, p]))
}

function expectedShown(delivered: Preview[]): Box {
  const winners = new Set(highestSeqPerDrag(delivered).values())
  const last = [...delivered].reverse().find((p) => winners.has(p))
  return last === undefined ? committed : { x: last.x, y: last.y, width: last.width, height: last.height }
}

function deliver(previews: Preview[]): Viewer {
  const viewer = new Viewer()
  for (const preview of previews) viewer.receive(preview)
  return viewer
}

void test("any delivery order applies the highest-seq current preview of each drag", () => {
  fc.assert(
    fc.property(delivery, (delivered) => {
      const viewer = deliver(delivered)
      assert.deepEqual(lastAppliedPerDrag(viewer.applied), highestSeqPerDrag(delivered))
      assert.deepEqual(viewer.shown, expectedShown(delivered))
    }),
    settings,
  )
})

void test("a preview based on an older version than the known one never applies", () => {
  fc.assert(
    fc.property(delivery, (delivered) => {
      const viewer = deliver(delivered)
      assert.deepEqual(
        viewer.applied.filter((p) => p.base_version < knownVersion),
        [],
      )
    }),
    settings,
  )
})

void test("drag_cancel returns to the committed position and ends that drag", () => {
  fc.assert(
    fc.property(delivery, fc.nat(), (delivered, cut) => {
      const split = cut % (delivered.length + 1)
      const viewer = deliver(delivered.slice(0, split))
      const cancelled = viewer.applied.at(-1)?.drag_id ?? "drag-a"

      viewer.cancel(cancelled)
      assert.deepEqual(viewer.shown, committed)

      const before = viewer.applied.length
      for (const preview of delivered) {
        if (preview.drag_id === cancelled) viewer.receive(preview)
      }
      assert.equal(viewer.applied.length, before)
      assert.deepEqual(viewer.shown, committed)
    }),
    settings,
  )
})

void test("re-delivering a preview is a no-op", () => {
  fc.assert(
    fc.property(delivery, (delivered) => {
      const viewer = deliver(delivered)
      const { shown } = viewer
      for (const preview of delivered) {
        assert.equal(viewer.previews.accept(preview, knownVersion), false)
      }
      assert.deepEqual(viewer.shown, shown)
    }),
    settings,
  )
})
