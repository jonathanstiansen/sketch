# Guardrails pass 3: transient-event registry, typed client events, gesture table

*2026-10-30T20:53:00Z by Showboat 0.6.1*
<!-- showboat-id: 5efdae2f-fec0-4161-986b-ff1018e9416c -->

Outcome: the seven gaps feature agents reported are now enforced by the build. (1) Relay-only events are declared in `SketchWeb.BoardEvents` with an example, `BoardLive` forwards only what it declares, and the A10 test sends every example. (2) Every client push is typed from a generated contract, and selection state cannot be declared in it. (3) The browser context check covers every tracked script, and the evidence scripts use the one helper. (4) Pointer gestures are a table that `pointerAction` and the help both read. (5) ARCHITECTURE.md's rule lists per check category are compared with `rules.exs`. (6) The process policy scans every tracked script. (7) A18's library names are registry data, with an exact E2E dependency allowlist. No new runtime dependency (A15), no migration.

Gap 1. `BoardLive` no longer lists relay events; both guards come from the registry, and every transient event has a generated A10 test:

```bash
grep -n "@relayed_events\|@ignored_when_malformed" lib/sketch_web/live/board_live.ex
```

```output
13:  @relayed_events SketchWeb.BoardEvents.relayed_events()
14:  @ignored_when_malformed Enum.map(SketchWeb.BoardEvents.all(), & &1.event) --
286:      when event in @ignored_when_malformed do
310:      when event in @relayed_events do
```

```bash
mix run --no-start -e 'for e <- SketchWeb.BoardEvents.transient(), do: IO.puts("#{e.event} -> #{e.relays_as}")' 2>&1 | tail -8; mix test test/sketch_web/live/board_live_drag_test.exs --only describe:"transient previews never trigger persistence (A10)" 2>&1 | grep -E "^Result"
```

```output
preview -> preview
drag_cancel -> drag_cancel
group_preview -> group_preview
group_cancel -> group_cancel
draw_preview -> draw_preview
draw_cancel -> draw_end
cursor -> cursor
cursor_leave -> cursor_leave
Result: 11 passed, 14 excluded
```

Mutation 1a, a new relay event that skips the registry: `undeclared-relay-event.patch` adds a `laser` handler that broadcasts. The parse of `BoardLive` fails:

```bash
docs/evidence/guardrails-3/mutate.sh undeclared-relay-event mix test test/architecture/board_events_test.exs 2>&1 | grep -E "^ +A10 |^Mutation" | sed -E "s/^ +//"
```

```output
A10 lib/sketch_web/live/board_live.ex: relays "laser", which SketchWeb.BoardEvents does not declare with an example
A10 lib/sketch_web/live/board_live.ex: relays "laser", which SketchWeb.BoardEvents does not declare
Mutation killed (exit 2)
```

Mutation 1b, a declared event that touches the database: `cursor-queries-the-database.patch` reads the elements in the `cursor` handler. The test for that event fails, with no test written for this case:

```bash
docs/evidence/guardrails-3/mutate.sh cursor-queries-the-database mix test test/sketch_web/live/board_live_drag_test.exs 2>&1 | grep -E "^ +[0-9]+\) test|^Mutation" | sed -E "s/^ +[0-9]+\) //; s/ \(SketchWeb.*//" | sort
```

```output
Mutation killed (exit 2)
test transient previews never trigger persistence (A10) cursor moves and leaves reach other views without any database query
test transient previews never trigger persistence (A10) the declared example of cursor reaches the other view as cursor without any database query
```

Gap 2. The manifest emits one payload type per event, and `pushClientEvent` is the only caller of `pushEvent`:

```bash
cat assets/js/hooks/client_events.ts; grep -n "readonly \"cursor\"\|readonly \"erase\"" assets/js/generated/manifest.ts; grep -rn "pushEvent" assets/js lib | grep -v "assets/js/hooks/client_events.ts" | wc -l | tr -d " "
```

```output
import type { ClientEventName, ClientEventPayloads } from "../generated/manifest.ts"

export interface EventPusher {
  pushEvent(event: string, payload: object): Promise<unknown>
}

export type DeclaredFieldsOnly<Payload, Declared> = Payload & Record<Exclude<keyof Payload, keyof Declared>, never>

export function pushClientEvent<Event extends ClientEventName, Payload extends ClientEventPayloads[Event]>(
  hook: EventPusher,
  event: Event,
  payload: DeclaredFieldsOnly<Payload, ClientEventPayloads[Event]>,
): Promise<unknown> {
  return hook.pushEvent(event, payload)
}
227:  readonly "cursor": { readonly seq: number; readonly x: number; readonly y: number }
231:  readonly "erase": { readonly element_ids: readonly string[] }
0
```

Mutation 2a, selection added to an existing push through a spread: `tsc` rejects it, even though the excess property check alone would not see a non-fresh object:

```bash
docs/evidence/guardrails-3/mutate.sh selection-in-cursor-push npm --prefix assets run typecheck 2>&1 | grep -E "error TS|^Mutation" | cut -c1-150
```

```output
js/hooks/canvas.ts(628,100): error TS2322: Type 'Selection' is not assignable to type 'never'.
Mutation killed (exit 2)
```

Mutation 2b, a raw push of the selection under a new event: the source scan fails:

```bash
docs/evidence/guardrails-3/mutate.sh raw-push-of-selection mix test test/architecture/board_events_test.exs 2>&1 | grep -E "^ +client_events |^Mutation" | sed -E "s/^ +//"
```

```output
client_events assets/js/hooks/canvas.ts:641: raw pushEvent: void this.pushEvent("selection_changed", { element_ids: this.selected })
Mutation killed (exit 2)
```

Mutation 2c, selection declared in the contract: compilation fails:

```bash
docs/evidence/guardrails-3/mutate.sh selection-field-in-contract mix compile 2>&1 | grep -E "CompileError|^Mutation"
```

```output
** (CompileError) SketchWeb.BoardEvents entry "cursor" has field :selected_ids: selection state is never pushed or broadcast (addendum D8)
Mutation killed (exit 1)
```

Gap 3. Ten evidence scripts moved to the helper by importing it from `e2e/`, so `e2e_context_paths` stays one file. The scan now covers every tracked script. I ran all ten against a local server and each exits 0 after the migration. The scan is clean, and the only direct call left is in the helper:

```bash
git grep -n -E "\.newContext\(|browser\.newPage\(" -- "*.mjs" "*.ts" ":!test/architecture/fixtures" ; git grep -l "tests/support/contexts.ts" -- "docs/evidence/*.mjs" | wc -l | tr -d " "
```

```output
e2e/tests/support/contexts.ts:13:  return browser.newContext(contextOptions(options))
10
```

Mutation 3, an evidence script creating its own context: `evidence-script-direct-context.patch` changes the zoom demo. Before this PR the scan read only `e2e/`:

```bash
docs/evidence/guardrails-3/mutate.sh evidence-script-direct-context mix test test/architecture/source_policy_test.exs 2>&1 | grep -E "^ +e2e_contexts |^Mutation" | sed -E "s/^ +//" | cut -c1-140
```

```output
e2e_contexts docs/evidence/zoom/zoom-demo.mjs:82: browser context created outside the shared helper: const contexts = await Promise.all([0, 
Mutation killed (exit 2)
```

Gap 4. The registries declare gestures, the manifest emits them and `pointerAction` only looks them up. The help rows come from the same declarations:

```bash
grep -E "action: \"(toggle|marquee|move|copy|zoom)\"" assets/js/generated/manifest.ts | sed -E "s/^ +//; s/tools: \[\"hand\".*\"eraser\"\]/tools: [all]/"; sed -n "/^export function pointerAction/,/^}/p" assets/js/hooks/tools.ts; mix run --no-start -e "for s <- SketchWeb.Shortcuts.all(), s.chords == [], do: IO.inspect({s.action, s.help_keys, s.suffix})" 2>&1 | tail -3
```

```output
{ group: "clipboard", action: "copy", contexts: ["canvas"], chords: [{ key: ["c"], code: null, mod: "command", shift: false, alt: false, modifiers: "exact" }] },
{ action: "marquee", button: "primary", tools: ["selection"], target: "empty", space: false, shift: null, alt: null, mod: null },
{ action: "copy", button: "primary", tools: ["selection"], target: "element", space: false, shift: null, alt: true, mod: null },
{ action: "toggle", button: "primary", tools: ["selection"], target: "element", space: false, shift: true, alt: false, mod: null },
{ action: "move", button: "primary", tools: ["selection"], target: "element", space: false, shift: false, alt: false, mod: null },
{ action: "zoom", button: "wheel", tools: [all], target: null, space: null, shift: null, alt: null, mod: "command" },
export function pointerAction({ button, tool, spaceHeld, onElement, onHandle, altKey = false, shiftKey = false }: PointerInput): PointerAction {
  const pressed = PRESS_BUTTONS[button]
  if (pressed === undefined) return "none"
  return gestureAction({
    button: pressed,
    tool,
    target: pressTarget(onElement, onHandle),
    space: spaceHeld,
    shift: shiftKey,
    alt: altKey,
    command: false,
  })
}
{"select_in_box", ["Drag"], "on empty canvas"}
{"toggle_selected", ["Shift"], "+ click"}
{"zoom_wheel", ["Ctrl/⌘"], "+ wheel or pinch"}
```

```bash
docs/evidence/pbt-drag-share/run-ts.sh test/tools.test.ts 2>&1 | grep -E "gesture|wheel|primary button|^ℹ (pass|fail)"
```

```output
✔ every declared pointer gesture maps to its action
✔ no input matches two pointer gestures
✔ a press with the primary button does something with every tool, and any other button but the middle does nothing
✔ the wheel zooms only with Ctrl or Command held, whatever the tool, and a press never zooms
✔ the hook draws each tool's kind with the gesture and click size from its spec
ℹ pass 15
ℹ fail 0
```

Mutation 4a, a hand-written branch in `pointerAction`: Alt+press on an element moves instead of copying. The property that every gesture maps to its action fails, and so does the independent model of the behaviour:

```bash
docs/evidence/guardrails-3/mutate.sh pointer-action-hand-written-branch docs/evidence/pbt-drag-share/run-ts.sh test/tools.test.ts 2>&1 | grep -E "^✖|^Mutation" | sort -u | cut -c1-120
```

```output
✖ every declared pointer gesture maps to its action
✖ failing tests:
✖ the middle button, Space and Hand pan; Rectangle, Diamond, Ellipse, Arrow, Draw, Line and Note draw; Text opens the ed
Mutation killed (exit 1)
```

Mutation 4b, two gestures that can match one input: `overlapping-gesture.patch` lets the toggle gesture ignore Alt. Compilation fails and names both:

```bash
docs/evidence/guardrails-3/mutate.sh overlapping-gesture mix compile 2>&1 | grep -E "CompileError|^Mutation" | cut -c1-140
```

```output
** (CompileError) Pointer gestures "copy" in SketchWeb.SelectionActions and "toggle" in SketchWeb.SelectionActions match the same input (A23
Mutation killed (exit 1)
```

Mutation 4c, a gesture action the hook does not handle: `gesture-without-handler.patch` renames an action in the registry and manifest. `tsc` fails on the hook's `Record<PointerAction, …>`:

```bash
docs/evidence/guardrails-3/mutate.sh gesture-without-handler npm --prefix assets run typecheck 2>&1 | grep -E "error TS|^Mutation" | cut -c1-170
```

```output
js/hooks/canvas.ts(711,7): error TS2353: Object literal may only specify known properties, and 'copy' does not exist in type 'Record<PointerAction, () => void>'.
Mutation killed (exit 2)
```

Gap 5. Mutation 5, a stale rule list: `stale-rule-list.patch` drops A12 from the compiled-code bullet in ARCHITECTURE.md:

```bash
docs/evidence/guardrails-3/mutate.sh stale-rule-list mix test test/architecture/registry_test.exs 2>&1 | grep -E "^ +rule_categories |^Mutation" | sed -E "s/^ +//"
```

```output
rule_categories ARCHITECTURE.md: Compiled code lists ["A01", "A02", "A03"]; architecture/rules.exs says ["A01", "A02", "A03", "A12"]
Mutation killed (exit 2)
```

Gap 6. Mutation 6, a script outside the old three directories: `kill-by-name-in-new-directory.patch` adds `ops/stop-everything.sh`, not yet added to git, which the old scan could not see:

```bash
docs/evidence/guardrails-3/mutate.sh kill-by-name-in-new-directory mix test test/architecture/source_policy_test.exs 2>&1 | grep -E "^ +processes |^Mutation" | sed -E "s/^ +//"
```

```output
processes ops/stop-everything.sh:2: pkill stops processes by name: pkill -f phoenix
Mutation killed (exit 2)
```

Gap 7. Mutation 7, a mock library under a name the denylist does not know: `new-mock-library-by-name.patch` adds `miragejs` to `e2e/package.json`:

```bash
docs/evidence/guardrails-3/mutate.sh new-mock-library-by-name mix test test/architecture/source_policy_test.exs 2>&1 | grep -E "^ +A18 |^Mutation" | sed -E "s/^ +//"
```

```output
A18 e2e/package.json: dependency miragejs is not in e2e_npm_deps
Mutation killed (exit 2)
```

Layout is unchanged, as this PR adds no control; the help panel row for the wheel moved within its group because gesture rows come before a registry's chords. The layout spec at the four widths:

```bash
docs/evidence/pbt-drag-share/run-e2e.sh layout.spec.ts
```

```output
8 passed
```

Every file this PR touched outside the evidence folder and the migrated evidence scripts, against `multi-select`:

```bash
git diff --name-status multi-select...HEAD -- . ":!docs/evidence" | sort -k2; git diff --stat --name-only multi-select...HEAD -- "docs/evidence/*.mjs" | sort
```

```output
M	.github/CODEOWNERS
M	AGENTS.md
M	ARCHITECTURE.md
M	architecture/rules.exs
M	assets/js/generated/manifest.ts
M	assets/js/hooks/canvas.ts
A	assets/js/hooks/client_events.ts
M	assets/js/hooks/element_history.ts
M	assets/js/hooks/tools.ts
M	assets/test/element_history.test.ts
M	assets/test/tools.test.ts
A	docs/adr/0011-declared-board-events-and-pointer-gestures.md
A	lib/sketch_web/board_events.ex
A	lib/sketch_web/board_events/contract.ex
M	lib/sketch_web/client_manifest.ex
M	lib/sketch_web/fixed_shortcuts.ex
M	lib/sketch_web/live/board_live.ex
M	lib/sketch_web/selection_actions.ex
M	lib/sketch_web/shortcuts.ex
M	lib/sketch_web/shortcuts/aggregate.ex
M	lib/sketch_web/tools.ex
A	test/architecture/board_events_test.exs
M	test/architecture/fixtures/files/a18/e2e/mock.spec.ts
M	test/architecture/fixtures/files/a18/e2e/package.json
A	test/architecture/fixtures/files/board_events/lib/board_live.ex
A	test/architecture/fixtures/files/client_events/assets/js/hooks/client_events.ts
A	test/architecture/fixtures/files/client_events/assets/js/hooks/raw.ts
A	test/architecture/fixtures/files/client_events/lib/announcer.ex
M	test/architecture/fixtures/files/doc_enumerations/ARCHITECTURE.md
A	test/architecture/fixtures/files/e2e_contexts/docs/evidence/demo/record.mjs
A	test/architecture/fixtures/files/e2e_contexts/tools/launch.mjs
A	test/architecture/fixtures/files/processes/ops/bin/stop-all
A	test/architecture/fixtures/files/processes/tools/stop.py
A	test/architecture/fixtures/files/rule_categories/ARCHITECTURE.md
A	test/architecture/fixtures/files/rule_categories/architecture/rules.exs
A	test/architecture/fixtures/typescript/client_events_selection.ts
M	test/architecture/registry_test.exs
M	test/architecture/source_policy_test.exs
M	test/architecture/typescript_policy_test.exs
M	test/sketch_web/live/board_live_drag_test.exs
M	test/sketch_web/shortcuts_test.exs
M	test/support/architecture_check.ex
docs/evidence/duplicate-paste/clipboard-demo.mjs
docs/evidence/export/export-sample.mjs
docs/evidence/hand-drawn/screenshots.mjs
docs/evidence/kind-registry/toolbar.mjs
docs/evidence/live-cursors/cursor-demo.mjs
docs/evidence/multi-select/multi-select-demo.mjs
docs/evidence/render-model/dom.mjs
docs/evidence/styling/screenshots.mjs
docs/evidence/undo-redo/undo-demo.mjs
docs/evidence/zoom/zoom-demo.mjs
```
