import { SHORTCUTS, type FocusContext, type Shortcut, type ShortcutAction, type ShortcutChord } from "../generated/manifest.ts"

export type { FocusContext, Shortcut, ShortcutAction }

export interface ShortcutInput {
  readonly key: string | undefined
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

const MODIFIERS: Record<ShortcutChord["mod"], (input: ShortcutInput) => boolean> = {
  none: (input) => !input.ctrlKey && !input.metaKey,
  command: (input) => input.ctrlKey || input.metaKey,
  ctrl: (input) => input.ctrlKey && !input.metaKey,
}

export function focusContext(editable: boolean): FocusContext {
  return editable ? "editor" : "canvas"
}

function pressesKey(chord: ShortcutChord, input: Pick<ShortcutInput, "key" | "code">): boolean {
  if (chord.code !== null) return chord.code === input.code
  return input.key !== undefined && chord.key.includes(input.key.toLowerCase())
}

export function matchesChord(chord: ShortcutChord, input: ShortcutInput): boolean {
  return (
    pressesKey(chord, input) &&
    MODIFIERS[chord.mod](input) &&
    (chord.shift === null || chord.shift === input.shiftKey) &&
    chord.alt === input.altKey
  )
}

function activeIn(shortcut: Shortcut, context: FocusContext): boolean {
  return shortcut.contexts.some((active) => active === context)
}

export function shortcutsFor(input: ShortcutInput, context: FocusContext): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => activeIn(shortcut, context) && shortcut.chords.some((chord: ShortcutChord) => matchesChord(chord, input)))
}

export function shortcutFor(input: ShortcutInput, context: FocusContext): Shortcut | undefined {
  return shortcutsFor(input, context)[0]
}

export function isShortcutKey(action: ShortcutAction, input: Pick<ShortcutInput, "key" | "code">): boolean {
  return SHORTCUTS.some((shortcut) => shortcut.action === action && shortcut.chords.some((chord: ShortcutChord) => pressesKey(chord, input)))
}
