import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { CONTEXT_OVERLAPS, FOCUS_CONTEXTS, SHORTCUTS, type FocusContext, type ShortcutChord } from "../js/generated/manifest.ts"
import { isShortcutKey, matchesChord, shortcutFor, shortcutsFor, type ShortcutInput } from "../js/hooks/shortcuts.ts"
import { anyModifiers, anyPress, press, usKey } from "./key_press.ts"

const settings = { seed: 1, numRuns: 2000 }
const anyContext = fc.constantFrom(...FOCUS_CONTEXTS)

function overlap(a: FocusContext, b: FocusContext): boolean {
  return CONTEXT_OVERLAPS.some(([left, right]) => (left === a && right === b) || (left === b && right === a))
}

const anyActiveContexts = fc
  .subarray([...FOCUS_CONTEXTS], { minLength: 1 })
  .filter((contexts) => contexts.every((a) => contexts.every((b) => a === b || overlap(a, b))))

function pressFor(chord: ShortcutChord, ctrlOrMeta: "ctrlKey" | "metaKey"): ShortcutInput {
  const shiftKey = chord.shift === true
  const modifiers = { ctrlKey: false, metaKey: false, shiftKey, altKey: chord.alt }
  if (chord.mod === "command") modifiers[ctrlOrMeta] = true
  if (chord.mod === "ctrl") modifiers.ctrlKey = true
  const key = chord.key[0]
  if (chord.code !== null) return { ...modifiers, code: chord.code, key: usKey(chord.code, shiftKey) }
  if (key === undefined) throw new Error("a chord names neither key nor code")
  return { ...modifiers, code: "", key }
}

void test("no key press matches two shortcuts in focus contexts that can be active at once (A23)", () => {
  fc.assert(
    fc.property(anyPress, anyActiveContexts, (input, contexts) => {
      const matched = shortcutsFor(input, contexts).map(({ action }) => action)
      assert.ok(matched.length <= 1, `${JSON.stringify(input)} in ${contexts.join(" and ")} matches ${matched.join(", ")}`)
    }),
    settings,
  )
})

void test("Esc is a cancel: it matches whatever modifiers are held, in every context it is declared for", () => {
  fc.assert(
    fc.property(anyModifiers, anyContext, (modifiers, context) => {
      const action = shortcutFor(press("Escape", modifiers), context)?.action
      assert.equal(action, context === "editor" ? "finish_text" : "escape")
    }),
    settings,
  )
})

void test("a modifier policy decides which held modifiers a chord ignores", () => {
  const exact: ShortcutChord = { key: ["escape"], code: null, mod: "none", shift: null, alt: false, modifiers: "exact" }
  const ignoreAlt: ShortcutChord = { ...exact, modifiers: "ignore_alt" }
  const any: ShortcutChord = { ...exact, modifiers: "any" }
  const altEscape = press("Escape", { altKey: true })
  const ctrlEscape = press("Escape", { ctrlKey: true })
  assert.ok(!matchesChord(exact, altEscape))
  assert.ok(matchesChord(ignoreAlt, altEscape))
  assert.ok(!matchesChord(ignoreAlt, ctrlEscape))
  assert.ok(matchesChord(any, altEscape))
  assert.ok(matchesChord(any, ctrlEscape))
  assert.ok(!matchesChord(any, press("KeyE", { altKey: true })))
})

void test("every chord in the table reaches its own action in each of its contexts", () => {
  for (const shortcut of SHORTCUTS) {
    for (const chord of shortcut.chords) {
      for (const context of shortcut.contexts) {
        const modifiers: readonly ("ctrlKey" | "metaKey")[] = chord.mod === "command" ? ["ctrlKey", "metaKey"] : ["ctrlKey"]
        for (const modifier of modifiers) {
          assert.equal(shortcutFor(pressFor(chord, modifier), context)?.action, shortcut.action)
        }
      }
    }
  }
})

void test("a chord needs its exact modifiers: Ctrl/⌘ for command, Ctrl alone for ctrl, neither for none", () => {
  const command: ShortcutChord = { key: ["z"], code: null, mod: "command", shift: false, alt: false, modifiers: "exact" }
  const ctrl: ShortcutChord = { key: ["y"], code: null, mod: "ctrl", shift: false, alt: false, modifiers: "exact" }
  const plain: ShortcutChord = { key: [], code: "Digit1", mod: "none", shift: null, alt: false, modifiers: "exact" }
  assert.ok(matchesChord(command, press("KeyZ", { ctrlKey: true })))
  assert.ok(matchesChord(command, press("KeyZ", { metaKey: true })))
  assert.ok(!matchesChord(command, press("KeyZ", { ctrlKey: true, shiftKey: true })))
  assert.ok(!matchesChord(command, press("KeyZ", { ctrlKey: true, altKey: true })))
  assert.ok(matchesChord(ctrl, press("KeyY", { ctrlKey: true })))
  assert.ok(!matchesChord(ctrl, press("KeyY", { metaKey: true })))
  assert.ok(matchesChord(plain, press("Digit1")))
  assert.ok(matchesChord(plain, press("Digit1", { shiftKey: true })))
  assert.ok(!matchesChord(plain, press("Digit1", { ctrlKey: true })))
})

void test("only the Space key releases the pan, whatever is held", () => {
  fc.assert(
    fc.property(anyPress, (input) => {
      assert.equal(isShortcutKey("pan", input), input.key === " ")
    }),
    settings,
  )
})

void test("a keydown without a key, as Chrome sends for autofill, matches nothing and does not throw", () => {
  const autofill: ShortcutInput = { key: undefined, code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }
  for (const context of FOCUS_CONTEXTS) assert.equal(shortcutFor(autofill, context), undefined)
  assert.equal(isShortcutKey("pan", autofill), false)
})

void test("key and code are read through the event's own getters, as on a real KeyboardEvent", () => {
  const prototype = Object.defineProperties({}, { key: { get: () => " " }, code: { get: () => "Space" } })
  const event: Pick<ShortcutInput, "key" | "code"> = Object.create(prototype) as Pick<ShortcutInput, "key" | "code">
  assert.deepEqual(Object.keys(event), [])
  assert.equal(isShortcutKey("pan", event), true)
})
