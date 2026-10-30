import fc from "fast-check"
import type { ShortcutInput } from "../js/hooks/shortcuts.ts"

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("")
const DIGITS = "1234567890".split("")
const SHIFTED_DIGITS = "!@#$%^&*()".split("")
const PUNCTUATION: readonly (readonly [string, string, string])[] = [
  ["Minus", "-", "_"],
  ["Equal", "=", "+"],
  ["Slash", "/", "?"],
  ["Space", " ", " "],
]
const NAMED = ["Escape", "Delete", "Backspace", "Enter", "Tab", "ArrowLeft", "Shift"] as const

export interface Modifiers {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

export const NO_MODIFIERS: Modifiers = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

export function usKey(code: string, shiftKey: boolean): string {
  if (code.startsWith("Key")) {
    const letter = code.slice(3).toLowerCase()
    return shiftKey ? letter.toUpperCase() : letter
  }
  if (code.startsWith("Digit")) {
    const digit = code.slice(5)
    return shiftKey ? (SHIFTED_DIGITS[DIGITS.indexOf(digit)] ?? digit) : digit
  }
  const punctuation = PUNCTUATION.find(([name]) => name === code)
  if (punctuation !== undefined) return shiftKey ? punctuation[2] : punctuation[1]
  return code
}

export function press(code: string, modifiers: Partial<Modifiers> = {}): ShortcutInput {
  const held = { ...NO_MODIFIERS, ...modifiers }
  return { ...held, code, key: usKey(code, held.shiftKey) }
}

export const anyCode = fc.constantFrom(
  ...LETTERS.map((letter) => `Key${letter.toUpperCase()}`),
  ...DIGITS.map((digit) => `Digit${digit}`),
  ...PUNCTUATION.map(([code]) => code),
  ...NAMED,
)

export const anyModifiers = fc.record({ ctrlKey: fc.boolean(), metaKey: fc.boolean(), shiftKey: fc.boolean(), altKey: fc.boolean() })

export const anyPress = fc.tuple(anyCode, anyModifiers).map(([code, modifiers]) => press(code, modifiers))
