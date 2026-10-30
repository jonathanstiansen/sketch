import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { changePayload, createPayload, historyActionFor, recordedElement, type HistoryKeyInput } from "../js/hooks/element_history.ts"
import { DEFAULT_STYLE } from "../js/elements/style.ts"

const settings = { seed: 1, numRuns: 500 }

function press(key: string, modifiers: Partial<HistoryKeyInput> = {}): HistoryKeyInput {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, editable: false, ...modifiers }
}

void test("Ctrl or Command with Z undoes; with Shift, or Ctrl with Y, it redoes", () => {
  assert.equal(historyActionFor(press("z", { ctrlKey: true })), "undo")
  assert.equal(historyActionFor(press("z", { metaKey: true })), "undo")
  assert.equal(historyActionFor(press("Z", { metaKey: true, shiftKey: true })), "redo")
  assert.equal(historyActionFor(press("Z", { ctrlKey: true, shiftKey: true })), "redo")
  assert.equal(historyActionFor(press("y", { ctrlKey: true })), "redo")
  assert.equal(historyActionFor(press("y", { metaKey: true })), undefined)
  assert.equal(historyActionFor(press("z")), undefined)
  assert.equal(historyActionFor(press("z", { ctrlKey: true, altKey: true })), undefined)
})

void test("no chord fires while an editor or input has focus, so its own text undo applies", () => {
  fc.assert(
    fc.property(
      fc.record({ key: fc.constantFrom("z", "Z", "y", "Y", "a"), ctrlKey: fc.boolean(), metaKey: fc.boolean(), shiftKey: fc.boolean(), altKey: fc.boolean() }),
      (input) => {
        assert.equal(historyActionFor({ ...input, editable: true }), undefined)
      },
    ),
    settings,
  )
})

const event = {
  id: "e1",
  board_id: "b1",
  kind: "line",
  x: 10,
  y: 20,
  width: 30,
  height: 40,
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
  ],
  text: "",
  seed: 9,
  version: 3,
  ...DEFAULT_STYLE,
  stroke_color: "red",
}

void test("an element event becomes a snapshot whose create payload has the same content", () => {
  const recorded = recordedElement(event)
  assert.ok(recorded !== undefined)
  assert.equal(recorded.id, "e1")
  const payload = createPayload(recorded.snapshot, "drag")
  const content = Object.fromEntries(Object.entries(event).filter(([key]) => !["id", "board_id", "version"].includes(key)))
  assert.deepEqual(payload, { ...content, drag_id: "drag" })
})

void test("a malformed element event is not recorded", () => {
  for (const broken of [null, { ...event, kind: "circle" }, { ...event, seed: -1 }, { ...event, x: 1.5 }, { ...event, stroke_color: "purple" }, { ...event, points: [{ x: 0 }] }]) {
    assert.equal(recordedElement(broken), undefined)
  }
})

void test("each change becomes the payload of its commit event", () => {
  assert.deepEqual(changePayload("e1", { event: "commit", x: 1, y: 2 }, "d"), { element_id: "e1", drag_id: "d", x: 1, y: 2 })
  assert.deepEqual(changePayload("e1", { event: "commit_style", property: "fill_color", value: "red" }, "d"), { element_id: "e1", fill_color: "red" })
  const box = { x: 1, y: 2, width: 3, height: 4 }
  assert.deepEqual(changePayload("e1", { event: "commit_shape", box, points: [] }, "d"), { element_id: "e1", drag_id: "d", ...box, points: [] })
  assert.deepEqual(changePayload("e1", { event: "commit_shape", box, points: [], text: "hi" }, "d"), {
    element_id: "e1",
    drag_id: "d",
    ...box,
    points: [],
    text: "hi",
  })
})
