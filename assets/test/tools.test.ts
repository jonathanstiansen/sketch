import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import {
  DEFAULT_TOOL,
  TOOLS,
  deletesSelection,
  nextTool,
  panScroll,
  pointerAction,
  selectionHandles,
  selectTool,
  typedKind,
  type KeyInput,
  type ToolId,
} from "../js/hooks/tools.ts"

const settings = { seed: 1, numRuns: 500 }

const expectedBindings: Record<string, ToolId> = {
  h: "hand",
  v: "selection",
  "1": "selection",
  r: "rectangle",
  "2": "rectangle",
  d: "diamond",
  "3": "diamond",
  o: "ellipse",
  "4": "ellipse",
  a: "arrow",
  "5": "arrow",
  l: "line",
  "6": "line",
  p: "draw",
  "7": "draw",
  t: "text",
  "8": "text",
  n: "note",
  "9": "note",
  e: "eraser",
  "0": "eraser",
  Escape: "selection",
}

function modelTool(current: ToolId, input: KeyInput): ToolId {
  if (input.editable || input.ctrlKey || input.metaKey || input.altKey) return current
  return expectedBindings[input.key] ?? expectedBindings[input.key.toLowerCase()] ?? current
}

function plainKey(key: string): KeyInput {
  return { key, ctrlKey: false, metaKey: false, altKey: false, editable: false }
}

const enabledTools = TOOLS.filter((tool) => tool.enabled)
const anyTool = fc.constantFrom(...TOOLS.map((tool) => tool.id))
const startTool = fc.constantFrom(...enabledTools.map((tool) => tool.id))
const toolKeys = TOOLS.flatMap((tool) => [tool.letter, tool.letter.toUpperCase(), ...(tool.digit === null ? [] : [tool.digit])])
const anyKey = fc.oneof(
  fc.constantFrom(...toolKeys, "Escape", "?", " ", "Enter", "Shift", "Tab", "ArrowLeft", "Delete", "Backspace"),
  fc.string({ maxLength: 3 }),
)
const anyKeyInput = fc.record({
  key: anyKey,
  ctrlKey: fc.boolean(),
  metaKey: fc.boolean(),
  altKey: fc.boolean(),
  editable: fc.boolean(),
})
const ignoredKeyInput = anyKeyInput.filter(
  (input) => input.ctrlKey || input.metaKey || input.altKey || input.editable,
)

void test("every enabled tool is reachable by its letter, in either case, and by its number", () => {
  fc.assert(
    fc.property(startTool, fc.constantFrom(...enabledTools), fc.boolean(), (start, tool, upper) => {
      const letter = upper ? tool.letter.toUpperCase() : tool.letter
      assert.equal(nextTool(start, plainKey(letter)), tool.id)
      if (tool.digit !== null) assert.equal(nextTool(start, plainKey(tool.digit)), tool.id)
    }),
    settings,
  )
})

void test("no two tools share a key, and no tool key is reserved for Esc, ? or Space", () => {
  fc.assert(
    fc.property(fc.constantFrom(...TOOLS), fc.constantFrom(...TOOLS), (a, b) => {
      const keysOf = (tool: (typeof TOOLS)[number]) => [tool.letter, ...(tool.digit === null ? [] : [tool.digit])]
      for (const key of keysOf(a)) {
        assert.ok(!["escape", "?", " "].includes(key), `${a.id} uses reserved key ${key}`)
        if (a.id !== b.id) assert.ok(!keysOf(b).includes(key), `${a.id} and ${b.id} share ${key}`)
      }
    }),
    settings,
  )
})

void test("any key sequence selects the same tool as the simple binding model", () => {
  fc.assert(
    fc.property(startTool, fc.array(anyKeyInput, { maxLength: 30 }), (start, inputs) => {
      let actual = start
      let expected = start
      for (const input of inputs) {
        actual = nextTool(actual, input)
        expected = modelTool(expected, input)
        assert.equal(actual, expected, `after ${JSON.stringify(input)}`)
      }
    }),
    settings,
  )
})

void test("a key with Ctrl, Meta or Alt, or typed into an editable target, never changes the tool", () => {
  fc.assert(
    fc.property(anyTool, ignoredKeyInput, (start, input) => {
      assert.equal(nextTool(start, input), start)
    }),
    settings,
  )
})

void test("Esc always returns to Selection", () => {
  fc.assert(
    fc.property(anyTool, (start) => {
      assert.equal(nextTool(start, plainKey("Escape")), DEFAULT_TOOL)
    }),
    settings,
  )
})

const anyAction = fc.oneof(
  anyKeyInput.map((input) => ({ kind: "key" as const, input })),
  anyTool.map((tool) => ({ kind: "click" as const, tool })),
)

void test("every tool is enabled, and keys or toolbar clicks only ever select an enabled tool", () => {
  assert.deepEqual(TOOLS.filter((tool) => !tool.enabled), [])
  const unknownTool = fc.string({ maxLength: 8 }).filter((id) => !TOOLS.some((tool) => tool.id === id))
  fc.assert(
    fc.property(startTool, fc.array(anyAction, { maxLength: 30 }), unknownTool, (start, actions, unknown) => {
      let tool = start
      for (const action of actions) {
        tool = action.kind === "key" ? nextTool(tool, action.input) : selectTool(tool, action.tool)
        assert.ok(enabledTools.some(({ id }) => id === tool), `${tool} became active`)
      }
      assert.equal(selectTool(tool, unknown), tool)
    }),
    settings,
  )
})

void test("Delete and Backspace erase the selection only as plain keys outside an editable target", () => {
  fc.assert(
    fc.property(anyKeyInput, (input) => {
      const plain = !input.editable && !input.ctrlKey && !input.metaKey && !input.altKey
      assert.equal(deletesSelection(input), plain && ["Delete", "Backspace"].includes(input.key))
      assert.equal(deletesSelection({ ...input, key: "Delete" }), plain)
      assert.equal(deletesSelection({ ...input, key: "Backspace" }), plain)
    }),
    settings,
  )
})

const pointerInput = fc.record({
  button: fc.integer({ min: 0, max: 4 }),
  tool: startTool,
  spaceHeld: fc.boolean(),
  onElement: fc.boolean(),
  onHandle: fc.boolean(),
})

void test("the middle button, Space and Hand pan; Rectangle, Diamond, Ellipse, Arrow, Draw, Line and Note draw; Text opens the editor; Eraser erases; Selection resizes, moves or deselects", () => {
  fc.assert(
    fc.property(pointerInput, (input) => {
      const action = pointerAction(input)
      const primary = input.button === 0
      const pans = input.button === 1 || (primary && (input.spaceHeld || input.tool === "hand"))
      const selecting = primary && !pans && input.tool === "selection"
      assert.equal(action === "pan", pans)
      const drawing = ["rectangle", "diamond", "ellipse", "arrow", "draw", "line", "note"].includes(input.tool)
      assert.equal(action === "draw", primary && !pans && drawing)
      assert.equal(action === "text", primary && !pans && input.tool === "text")
      assert.equal(action === "erase", primary && !pans && input.tool === "eraser")
      assert.equal(action === "resize", selecting && input.onHandle)
      assert.equal(action === "move", selecting && !input.onHandle && input.onElement)
      assert.equal(action === "deselect", selecting && !input.onHandle && !input.onElement)
    }),
    settings,
  )
})

void test("a pointer action of text always has a typed kind to create or edit, and only the Text tool has one", () => {
  for (const { id } of TOOLS) {
    const action = pointerAction({ button: 0, tool: id, spaceHeld: false, onElement: false, onHandle: false })
    assert.equal(typedKind(id) !== undefined, action === "text", id)
  }
  assert.equal(typedKind("text"), "text")
})

const anyPoint = fc.record({ x: fc.integer({ min: -5000, max: 5000 }), y: fc.integer({ min: -5000, max: 5000 }) })

void test("panning scrolls by exactly the opposite of the pointer movement", () => {
  fc.assert(
    fc.property(anyPoint, anyPoint, anyPoint, (scroll, start, pointer) => {
      const next = panScroll(scroll, start, pointer)
      assert.deepEqual(
        { x: next.x - scroll.x, y: next.y - scroll.y },
        { x: start.x - pointer.x, y: start.y - pointer.y },
      )
    }),
    settings,
  )
})

void test("lines and arrows get endpoint handles, text gets none and every other kind gets corners", () => {
  assert.deepEqual(
    ["line", "arrow", "text", "rectangle", "diamond", "ellipse", "freedraw", undefined].map(selectionHandles),
    ["endpoints", "endpoints", "none", "corners", "corners", "corners", "corners", "corners"],
  )
})
