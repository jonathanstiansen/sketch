import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import {
  DEFAULT_TOOL,
  TOOLS,
  defaultSize,
  deletesSelection,
  drawGesture,
  drawnKind,
  nextTool,
  gestureMatches,
  panScroll,
  pointerAction,
  selectionHandles,
  selectTool,
  typedKind,
  wheelAction,
  type KeyInput,
  type ToolId,
} from "../js/hooks/tools.ts"
import { POINTER_GESTURES, type PointerGestureSpec } from "../js/generated/manifest.ts"
import { anyModifiers, anyPress, press, type Modifiers } from "./key_press.ts"

const settings = { seed: 1, numRuns: 500 }

const letterBindings: Record<string, ToolId> = {
  h: "hand",
  v: "selection",
  r: "rectangle",
  d: "diamond",
  o: "ellipse",
  a: "arrow",
  l: "line",
  p: "draw",
  t: "text",
  n: "note",
  e: "eraser",
}

const digitBindings: Record<string, ToolId> = {
  Digit1: "selection",
  Digit2: "rectangle",
  Digit3: "diamond",
  Digit4: "ellipse",
  Digit5: "arrow",
  Digit6: "line",
  Digit7: "draw",
  Digit8: "text",
  Digit9: "note",
  Digit0: "eraser",
}

function modelTool(current: ToolId, input: KeyInput): ToolId {
  if (input.editable) return current
  if (input.key === "Escape") return DEFAULT_TOOL
  if (input.ctrlKey || input.metaKey || input.altKey) return current
  const byDigit = input.shiftKey ? undefined : digitBindings[input.code]
  return byDigit ?? letterBindings[(input.key ?? "").toLowerCase()] ?? current
}

function plainKey(code: string, modifiers: Partial<Modifiers> = {}): KeyInput {
  return { ...press(code, modifiers), editable: false }
}

const enabledTools = TOOLS.filter((tool) => tool.enabled)
const anyTool = fc.constantFrom(...TOOLS.map((tool) => tool.id))
const startTool = fc.constantFrom(...enabledTools.map((tool) => tool.id))
const anyKeyInput = fc.tuple(anyPress, fc.boolean()).map(([input, editable]) => ({ ...input, editable }))
const ignoredKeyInput = anyKeyInput.filter(
  (input) => input.key !== "Escape" && (input.ctrlKey || input.metaKey || input.altKey || input.editable),
)

void test("every tool is reachable by its letter, with or without Shift, and by its number-row digit without Shift", () => {
  for (const [letter, tool] of Object.entries(letterBindings)) {
    const code = `Key${letter.toUpperCase()}`
    assert.equal(nextTool("hand", plainKey(code)), tool)
    assert.equal(nextTool("hand", plainKey(code, { shiftKey: true })), tool)
  }
  for (const [code, tool] of Object.entries(digitBindings)) {
    assert.equal(nextTool("hand", plainKey(code)), tool)
    assert.equal(nextTool("hand", plainKey(code, { shiftKey: true })), "hand")
  }
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

void test("a key other than Esc with Ctrl, Meta or Alt, or typed into an editable target, never changes the tool", () => {
  fc.assert(
    fc.property(anyTool, ignoredKeyInput, (start, input) => {
      assert.equal(nextTool(start, input), start)
    }),
    settings,
  )
})

void test("Esc returns to Selection whatever modifiers are held", () => {
  fc.assert(
    fc.property(anyTool, anyModifiers, (start, modifiers) => {
      assert.equal(nextTool(start, plainKey("Escape", modifiers)), DEFAULT_TOOL)
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
      assert.equal(deletesSelection(input), plain && ["Delete", "Backspace"].includes(input.key ?? ""))
      assert.equal(deletesSelection({ ...input, code: "Delete", key: "Delete" }), plain)
      assert.equal(deletesSelection({ ...input, code: "Backspace", key: "Backspace" }), plain)
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
  altKey: fc.boolean(),
  shiftKey: fc.boolean(),
})

void test("the middle button, Space and Hand pan; Rectangle, Diamond, Ellipse, Arrow, Draw, Line and Note draw; Text opens the editor; Eraser erases; Selection resizes, copies, toggles, moves or draws a marquee", () => {
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
      const onElement = selecting && !input.onHandle && input.onElement
      assert.equal(action === "copy", onElement && input.altKey)
      assert.equal(action === "toggle", onElement && !input.altKey && input.shiftKey)
      assert.equal(action === "move", onElement && !input.altKey && !input.shiftKey)
      assert.equal(action === "marquee", selecting && !input.onHandle && !input.onElement)
    }),
    settings,
  )
})

const BOOLEANS = [false, true] as const
const GESTURE_BUTTONS = ["primary", "middle", "wheel"] as const
const GESTURE_TARGETS = ["element", "empty", "handle"] as const

const everyGestureInput = TOOLS.flatMap(({ id: tool }) =>
  GESTURE_BUTTONS.flatMap((button) =>
    GESTURE_TARGETS.flatMap((target) =>
      BOOLEANS.flatMap((space) =>
        BOOLEANS.flatMap((shift) => BOOLEANS.flatMap((alt) => BOOLEANS.map((command) => ({ button, tool, target, space, shift, alt, command })))),
      ),
    ),
  ),
)

function gestureInput(gesture: PointerGestureSpec) {
  return fc.record({
    tool: fc.constantFrom(...gesture.tools),
    target: gesture.target === null ? fc.constantFrom(...GESTURE_TARGETS) : fc.constant(gesture.target),
    space: gesture.space === null ? fc.boolean() : fc.constant(gesture.space),
    shift: gesture.shift === null ? fc.boolean() : fc.constant(gesture.shift),
    alt: gesture.alt === null ? fc.boolean() : fc.constant(gesture.alt),
    ctrlKey: gesture.mod === null ? fc.boolean() : fc.constant(true),
  })
}

void test("every declared pointer gesture maps to its action", () => {
  for (const gesture of POINTER_GESTURES) {
    fc.assert(
      fc.property(gestureInput(gesture), ({ tool, target, space, shift, alt, ctrlKey }) => {
        const action =
          gesture.button === "wheel"
            ? wheelAction({ tool, ctrlKey, metaKey: false })
            : pointerAction({
                button: gesture.button === "primary" ? 0 : 1,
                tool,
                spaceHeld: space,
                onElement: target === "element",
                onHandle: target === "handle",
                altKey: alt,
                shiftKey: shift,
              })
        assert.equal(action, gesture.action)
      }),
      settings,
    )
  }
})

void test("no input matches two pointer gestures", () => {
  for (const input of everyGestureInput) {
    const matching = POINTER_GESTURES.filter((gesture) => gestureMatches(gesture, input))
    assert.ok(matching.length <= 1, `${JSON.stringify(input)} matches ${JSON.stringify(matching)}`)
  }
})

void test("a press with the primary button does something with every tool, and any other button but the middle does nothing", () => {
  fc.assert(
    fc.property(pointerInput, (input) => {
      const action = pointerAction(input)
      if (input.button === 0) assert.notEqual(action, "none")
      if (input.button > 1) assert.equal(action, "none")
    }),
    settings,
  )
})

void test("the wheel zooms only with Ctrl or Command held, whatever the tool, and a press never zooms", () => {
  fc.assert(
    fc.property(startTool, fc.boolean(), fc.boolean(), (tool, ctrlKey, metaKey) => {
      assert.equal(wheelAction({ tool, ctrlKey, metaKey }), ctrlKey || metaKey ? "zoom" : "none")
    }),
    settings,
  )
  fc.assert(
    fc.property(pointerInput, (input) => {
      assert.notEqual(pointerAction(input), "zoom")
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

void test("the hook draws each tool's kind with the gesture and click size from its spec", () => {
  const drawn = TOOLS.flatMap(({ id }) => {
    const kind = drawnKind(id)
    return kind === undefined ? [] : [[id, drawGesture(kind), defaultSize(kind)] as const]
  })
  assert.deepEqual(drawn, [
    ["rectangle", "box", { width: 120, height: 80 }],
    ["diamond", "box", { width: 120, height: 80 }],
    ["ellipse", "box", { width: 120, height: 80 }],
    ["arrow", "two_point", { width: 120, height: 80 }],
    ["line", "two_point", { width: 120, height: 80 }],
    ["draw", "path", { width: 120, height: 80 }],
    ["note", "box", { width: 200, height: 160 }],
  ])
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
