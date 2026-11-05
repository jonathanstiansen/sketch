import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { RemoteCursors, isRemoteCursor, type RemoteCursor } from "../js/hooks/cursor_logic.ts"

const settings = { seed: 1, numRuns: 500 }
const viewers = ["viewer-a", "viewer-b", "viewer-c"]

interface Event {
  viewer: string
  seq: number
  leave: boolean
  x: number
  y: number
}

function cursor({ viewer, seq, x, y }: Event): RemoteCursor {
  return { viewer_id: viewer, name: `Name ${viewer}`, color: "red", x, y, seq }
}

function apply(cursors: RemoteCursors, event: Event): void {
  if (event.leave) cursors.leave(event.viewer, event.seq)
  else cursors.accept(cursor(event))
}

const delivery = fc
  .array(fc.record({ viewer: fc.constantFrom(...viewers), leave: fc.boolean(), x: fc.nat(4000), y: fc.nat(4000) }), { minLength: 1, maxLength: 20 })
  .map((events) => {
    const nextSeq = new Map<string, number>()
    return events.map((event): Event => {
      const seq = (nextSeq.get(event.viewer) ?? 0) + 1
      nextSeq.set(event.viewer, seq)
      return { ...event, seq }
    })
  })
  .chain((events) => fc.shuffledSubarray(events, { minLength: events.length }).map((shuffled) => ({ events, shuffled })))

void test("whatever order messages arrive in, each viewer ends where their newest message says", () => {
  fc.assert(
    fc.property(delivery, ({ events, shuffled }) => {
      const cursors = new RemoteCursors()
      for (const event of shuffled) apply(cursors, event)

      for (const viewer of viewers) {
        const newest = events.filter((event) => event.viewer === viewer).at(-1)
        const shown = cursors.visible().find((c) => c.viewer_id === viewer)
        if (newest === undefined || newest.leave) assert.equal(shown, undefined)
        else assert.deepEqual(shown, cursor(newest))
      }
    }),
    settings,
  )
})

void test("a late or repeated message never replaces a newer one", () => {
  const cursors = new RemoteCursors()
  const newer = { viewer: "viewer-a", seq: 5, leave: false, x: 50, y: 50 }
  assert.equal(cursors.accept(cursor(newer)), true)
  assert.equal(cursors.accept(cursor({ ...newer, seq: 4, x: 1 })), false)
  assert.equal(cursors.accept(cursor({ ...newer, x: 1 })), false)
  assert.deepEqual(cursors.visible(), [cursor(newer)])
})

void test("a leave stops an older cursor message from bringing the cursor back", () => {
  const cursors = new RemoteCursors()
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 1 })), true)
  assert.equal(cursors.leave("viewer-a", 3), true)
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 2, leave: false, x: 2, y: 2 })), false)
  assert.deepEqual(cursors.visible(), [])
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 4, leave: false, x: 3, y: 3 })), true)
})

void test("viewers do not affect each other", () => {
  fc.assert(
    fc.property(delivery, ({ shuffled }) => {
      const together = new RemoteCursors()
      for (const event of shuffled) apply(together, event)
      for (const viewer of viewers) {
        const alone = new RemoteCursors()
        for (const event of shuffled.filter((e) => e.viewer === viewer)) apply(alone, event)
        assert.deepEqual(
          together.visible().filter((c) => c.viewer_id === viewer),
          alone.visible(),
        )
      }
    }),
    settings,
  )
})

void test("a still cursor stays until its viewer leaves the canvas or the board", () => {
  const cursors = new RemoteCursors()
  cursors.accept(cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 1 }))
  cursors.accept(cursor({ viewer: "viewer-b", seq: 1, leave: false, x: 2, y: 2 }))
  assert.equal(cursors.visible().length, 2)
  assert.equal(cursors.leave("viewer-a", 2), true)
  assert.equal(cursors.forget("viewer-b"), true)
  assert.deepEqual(cursors.visible(), [])
})

void test("a viewer that left the board never comes back from a late message", () => {
  const cursors = new RemoteCursors()
  cursors.accept(cursor({ viewer: "viewer-a", seq: 3, leave: false, x: 1, y: 1 }))
  cursors.forget("viewer-a")
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 99, leave: false, x: 2, y: 2 })), false)
  assert.equal(cursors.find("viewer-a"), undefined)
})

void test("clearing forgets every cursor and its sequence numbers, for a reconnect", () => {
  const cursors = new RemoteCursors()
  cursors.accept(cursor({ viewer: "viewer-a", seq: 5, leave: false, x: 1, y: 1 }))
  assert.deepEqual(cursors.clear(), ["viewer-a"])
  assert.deepEqual(cursors.visible(), [])
  assert.equal(cursors.accept(cursor({ viewer: "viewer-a", seq: 5, leave: false, x: 2, y: 2 })), true)
})

void test("payloads without a viewer, a position or a sequence number are not cursors", () => {
  const valid = cursor({ viewer: "viewer-a", seq: 1, leave: false, x: 1, y: 2 })
  assert.equal(isRemoteCursor(valid), true)
  for (const broken of [null, "x", {}, { ...valid, x: 1.5 }, { ...valid, seq: "1" }, { ...valid, name: 3 }, { ...valid, viewer_id: undefined }]) {
    assert.equal(isRemoteCursor(broken), false)
  }
})
