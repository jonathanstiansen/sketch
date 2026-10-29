import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import {
  DEFAULT_TOOL,
  TOOLS,
  nextTool,
  panScroll,
  pointerAction,
  selectTool,
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
  Escape: "selection",
}

const disabledTools = new Set<ToolId>(["diamond", "ellipse", "arrow", "line", "draw", "text", "note", "eraser"])

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
  fc.constantFrom(...toolKeys, "Escape", "?", " ", "Enter", "Shift", "Tab", "ArrowLeft"),
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

void test("disabled tools never become active through keys or toolbar clicks", () => {
  fc.assert(
    fc.property(startTool, fc.array(anyAction, { maxLength: 30 }), (start, actions) => {
      let tool = start
      for (const action of actions) {
        tool = action.kind === "key" ? nextTool(tool, action.input) : selectTool(tool, action.tool)
        assert.ok(!disabledTools.has(tool), `${tool} became active`)
      }
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

void test("the middle button, Space and Hand pan; Rectangle draws; Selection resizes, moves or deselects", () => {
  fc.assert(
    fc.property(pointerInput, (input) => {
      const action = pointerAction(input)
      const primary = input.button === 0
      const pans = input.button === 1 || (primary && (input.spaceHeld || input.tool === "hand"))
      const selecting = primary && !pans && input.tool === "selection"
      assert.equal(action === "pan", pans)
      assert.equal(action === "draw", primary && !pans && input.tool === "rectangle")
      assert.equal(action === "resize", selecting && input.onHandle)
      assert.equal(action === "move", selecting && !input.onHandle && input.onElement)
      assert.equal(action === "deselect", selecting && !input.onHandle && !input.onElement)
    }),
    settings,
  )
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
