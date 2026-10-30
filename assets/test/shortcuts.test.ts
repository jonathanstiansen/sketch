import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { FOCUS_CONTEXTS, SHORTCUTS, type ShortcutChord } from "../js/generated/manifest.ts"
import { isShortcutKey, matchesChord, shortcutFor, shortcutsFor, type ShortcutInput } from "../js/hooks/shortcuts.ts"
import { anyPress, press, usKey } from "./key_press.ts"

const settings = { seed: 1, numRuns: 2000 }
const anyContext = fc.constantFrom(...FOCUS_CONTEXTS)

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

void test("no key press matches two shortcuts in one focus context (A23)", () => {
  fc.assert(
    fc.property(anyPress, anyContext, (input, context) => {
      const matched = shortcutsFor(input, context).map(({ action }) => action)
      assert.ok(matched.length <= 1, `${JSON.stringify(input)} in ${context} matches ${matched.join(", ")}`)
    }),
    settings,
  )
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
  const command: ShortcutChord = { key: ["z"], code: null, mod: "command", shift: false, alt: false }
  const ctrl: ShortcutChord = { key: ["y"], code: null, mod: "ctrl", shift: false, alt: false }
  const plain: ShortcutChord = { key: [], code: "Digit1", mod: "none", shift: null, alt: false }
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
