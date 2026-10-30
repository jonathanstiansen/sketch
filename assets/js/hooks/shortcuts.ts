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

export type ActiveContexts = FocusContext | readonly FocusContext[]

const MODIFIERS: Record<ShortcutChord["mod"], (input: ShortcutInput) => boolean> = {
  none: (input) => !input.ctrlKey && !input.metaKey,
  command: (input) => input.ctrlKey || input.metaKey,
  ctrl: (input) => input.ctrlKey && !input.metaKey,
}

function modsAndShiftHold(chord: ShortcutChord, input: ShortcutInput): boolean {
  return MODIFIERS[chord.mod](input) && (chord.shift === null || chord.shift === input.shiftKey)
}

const POLICIES: Record<ShortcutChord["modifiers"], (chord: ShortcutChord, input: ShortcutInput) => boolean> = {
  exact: (chord, input) => modsAndShiftHold(chord, input) && chord.alt === input.altKey,
  ignore_alt: modsAndShiftHold,
  any: () => true,
}

export function focusContext(editable: boolean): FocusContext {
  return editable ? "editor" : "canvas"
}

function pressesKey(chord: ShortcutChord, input: Pick<ShortcutInput, "key" | "code">): boolean {
  if (chord.code !== null) return chord.code === input.code
  return input.key !== undefined && chord.key.includes(input.key.toLowerCase())
}

export function matchesChord(chord: ShortcutChord, input: ShortcutInput): boolean {
  return pressesKey(chord, input) && POLICIES[chord.modifiers](chord, input)
}

function activeIn(shortcut: Shortcut, active: ActiveContexts): boolean {
  const contexts: readonly FocusContext[] = typeof active === "string" ? [active] : active
  return shortcut.contexts.some((context) => contexts.includes(context))
}

export function shortcutsFor(input: ShortcutInput, active: ActiveContexts): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => activeIn(shortcut, active) && shortcut.chords.some((chord: ShortcutChord) => matchesChord(chord, input)))
}

export function shortcutFor(input: ShortcutInput, active: ActiveContexts): Shortcut | undefined {
  return shortcutsFor(input, active)[0]
}

export function isShortcutKey(action: ShortcutAction, input: Pick<ShortcutInput, "key" | "code">): boolean {
  return SHORTCUTS.some((shortcut) => shortcut.action === action && shortcut.chords.some((chord: ShortcutChord) => pressesKey(chord, input)))
}
