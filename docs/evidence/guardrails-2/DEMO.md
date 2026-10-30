# Guardrails from agent reports: registry-declared shortcut groups, modifier policy, one E2E context helper

*2026-10-30T16:11:37Z by Showboat 0.6.1*
<!-- showboat-id: 430dcac2-2564-47b3-ab96-9e0027a95d05 -->

Outcome: the four gaps the duplicate-paste agent reported are now enforced by the build. (1) Docs no longer list shortcut registries, and a source-policy test rejects any living doc that enumerates registries, kinds, tools, style tokens, focus contexts or groups (CI requirement 10). (2) Registries declare their own shortcut groups and focus contexts as data, with overlapping contexts declared explicitly; a chord shared by contexts that can be active at once fails compilation. The clipboard chords now have their own `clipboard` group. (3) Every chord names a modifier policy; Esc ignores held modifiers, so it cancels an Alt+drag, and a generated fixture checks that the client matcher and the server conflict model agree. (4) Every E2E browser context comes from one helper with the shared options, and a scan rejects `browser.newContext` anywhere else (CI requirement 11). No new runtime dependency (A15), no migration.

The groups and contexts are declared by the registries, not by the enforcement module. `SketchWeb.FixedShortcuts` declares the two base contexts and the groups it owns:

```bash
sed -n "/@contexts \[/,/^  \]/p;/def shortcut_groups/p" lib/sketch_web/fixed_shortcuts.ex
```

```output
  @contexts [
    %{id: :canvas, description: "Nothing editable has focus", overlaps: []},
    %{id: :editor, description: "Text entry has focus", overlaps: []}
  ]
  def shortcut_groups, do: [:canvas, :editor]
```

```bash
mix run --no-start -e "IO.inspect(SketchWeb.Shortcuts.groups()); IO.inspect(SketchWeb.Shortcuts.get(\"duplicate\").group)" 2>&1 | tail -2
```

```output
[:tool, :history, :clipboard, :zoom, :export, :canvas, :editor]
:clipboard
```

Every chord carries `modifiers:`. The Esc chords are `:any`, the rest `:exact`:

```bash
grep -E "action: \"(escape|finish_text|duplicate|undo)\"" assets/js/generated/manifest.ts | sed -E "s/^ +//"
```

```output
{ group: "history", action: "undo", contexts: ["canvas"], chords: [{ key: ["z"], code: null, mod: "command", shift: false, alt: false, modifiers: "exact" }] },
{ group: "clipboard", action: "duplicate", contexts: ["canvas"], chords: [{ key: ["d"], code: null, mod: "command", shift: false, alt: false, modifiers: "exact" }] },
{ group: "canvas", action: "escape", contexts: ["canvas"], chords: [{ key: ["escape"], code: null, mod: "none", shift: null, alt: false, modifiers: "any" }] },
{ group: "editor", action: "finish_text", contexts: ["editor"], chords: [{ key: ["escape"], code: null, mod: "none", shift: null, alt: false, modifiers: "any" }] },
```

The Elixir tests: no conflicts in the real aggregate across contexts active together; groups come from the registries; a duplicate chord across registries fails `Code.compile_string`; a new context that overlaps `canvas` fails on a canvas chord while one that never overlaps compiles; stray, repeated and unknown groups and contexts fail; a table of collisions under each modifier policy (including Shift+`Digit1` against `!` and the `Space` code against the space key); and contradicting policies fail. With them, the architecture tests (A23 scan, docs check, E2E context scan, process policy, registry):

```bash
mix test test/sketch_web/shortcuts_test.exs test/architecture 2>&1 | grep -E "^Result"
```

```output
Result: 55 passed
```

On the client, the matcher applies the policy. fast-check: no press matches two shortcuts in contexts that can be active at once, Esc matches whatever modifiers are held, and every chord reaches its action:

```bash
docs/evidence/pbt-drag-share/run-ts.sh test/shortcuts.test.ts
```

```output
✔ no key press matches two shortcuts in focus contexts that can be active at once (A23)
✔ Esc is a cancel: it matches whatever modifiers are held, in every context it is declared for
✔ a modifier policy decides which held modifiers a chord ignores
✔ every chord in the table reaches its own action in each of its contexts
✔ a chord needs its exact modifiers: Ctrl/⌘ for command, Ctrl alone for ctrl, neither for none
✔ only the Space key releases the pan, whatever is held
✔ a keydown without a key, as Chrome sends for autofill, matches nothing and does not throw
✔ key and code are read through the event's own getters, as on a real KeyboardEvent
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

`mix sketch.gen.render_fixtures` writes `assets/test/fixtures/shortcut_parity.json`: 252 chords over keys and physical codes with every valid combination of `mod`, `shift`, `alt` and policy, and the server verdict for all 31,878 pairs. The client test checks, exhaustively and as a fast-check property, that some modelled press matches both chords of a pair exactly when the server says they collide. Its press model is the client's own (US characters from `key_press.ts`, the unshifted character with Shift held, any character from another key), not a copy of the server table. The model this PR replaced would fail it: it compared the `Space` code as the word "space" rather than the key " ", and ignored that Shift+`Digit1` types `!`; the current table had no chord pair that hit either.

```bash
docs/evidence/pbt-drag-share/run-ts.sh test/shortcut_parity.test.ts
```

```output
✔ the fixture has a server verdict for every pair of chords
✔ a press the client matches with both chords of a pair is one the server calls a collision (A23)
✔ the server calls a pair a collision exactly when some press matches both chords on the client
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

```bash
mix sketch.gen.render_fixtures --check 2>&1 | grep shortcut
```

```output
assets/test/fixtures/shortcut_parity.json is up to date
```

Every E2E browser context now comes from `e2e/tests/support/contexts.ts`, which adds the shared options; `playwright.config.ts` uses the same function for the `page` fixture. Playwright does fill unset `use` options into `browser.newContext()` (its `runBeforeCreateBrowserContext` hook), but a spec that passes its own `permissions` replaces the shared list, and the specs each spelled the permissions differently. The helper merges them:

```bash
cat e2e/tests/support/contexts.ts; grep -n "contextOptions" e2e/playwright.config.ts
```

```output
import type { Browser, BrowserContext, BrowserContextOptions } from "@playwright/test"

export const SHARED_CONTEXT_OPTIONS = {
  permissions: ["clipboard-read", "clipboard-write"],
} as const satisfies BrowserContextOptions

export function contextOptions(options: BrowserContextOptions = {}): BrowserContextOptions {
  const permissions = [...new Set([...SHARED_CONTEXT_OPTIONS.permissions, ...(options.permissions ?? [])])]
  return { ...SHARED_CONTEXT_OPTIONS, ...options, permissions }
}

export function newContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  return browser.newContext(contextOptions(options))
}
2:import { contextOptions } from "./tests/support/contexts"
17:    ...contextOptions({ baseURL }),
```

```bash
grep -rn "\.newContext(" e2e/tests e2e/playwright.config.ts
```

```output
e2e/tests/support/contexts.ts:13:  return browser.newContext(contextOptions(options))
```

The clipboard spec, now with Esc pressed while Alt is still held during an Alt+drag (B sees the preview disappear and the original unmoved), and the layout spec at the four widths:

```bash
docs/evidence/pbt-drag-share/run-e2e.sh clipboard.spec.ts
```

```output
6 passed
```

```bash
docs/evidence/pbt-drag-share/run-e2e.sh layout.spec.ts
```

```output
8 passed
```

Each mutation is applied by `mutate.sh` from `mutations/`, the check runs, and an `EXIT` trap reverts the patch; `mutate.sh` prints `Mutation killed` only when the check fails. `with-patch.sh` is the same without the verdict, for a change that should pass.

Demonstration 1, a registry added without touching any doc: `new-registry.patch` adds `SketchWeb.PresentActions` to `@registries`. The docs check passes, because no doc lists the registries any more; there is nothing to go stale:

```bash
docs/evidence/guardrails-2/with-patch.sh new-registry mix test test/architecture/source_policy_test.exs 2>&1 | grep -E "^Result|^Exit"
```

```output
Result: 20 passed
Exit 0 with new-registry applied
```

Mutation 1, a stale enumerated list: `stale-registry-list.patch` puts the pre-clipboard registry list back into the ARCHITECTURE.md how-to, as the A23 text had it. The docs check fails on both lines, naming the function to refer to:

```bash
docs/evidence/guardrails-2/mutate.sh stale-registry-list mix test test/architecture/source_policy_test.exs 2>&1 | grep -E "^ +doc_enumerations |^Mutation" | sed -E "s/^ +//"
```

```output
doc_enumerations ARCHITECTURE.md:76: lists 2 shortcut registries (Tools, HistoryActions); refer to SketchWeb.Shortcuts.registries/0 instead
doc_enumerations ARCHITECTURE.md:77: lists 3 shortcut registries (ZoomActions, ExportActions, FixedShortcuts); refer to SketchWeb.Shortcuts.registries/0 instead
Mutation killed (exit 2)
```

Mutation 2, a conflict across overlapping contexts: `overlapping-context-conflict.patch` declares a `selection` context that can be active with `canvas` and binds plain `D` there to Deselect. `D` is the Diamond tool on the canvas, so compilation fails and names both actions and contexts:

```bash
docs/evidence/guardrails-2/mutate.sh overlapping-context-conflict mix compile 2>&1 | grep -E "duplicate chords|both match|^Mutation"
```

```output
** (CompileError) SketchWeb.Shortcuts has duplicate chords (A23):
  D (diamond in SketchWeb.Tools, [:canvas]) and D (deselect in SketchWeb.FixedShortcuts, [:selection]) both match while :canvas and :selection are active
Mutation killed (exit 1)
```

Mutation 3, Esc not ignoring Alt: `esc-requires-alt-up.patch` sets both Esc chords back to `modifiers: :exact` (in the registry and the generated manifest). The fast-check property fails, and so does the E2E test that presses Esc during an Alt+drag:

```bash
docs/evidence/guardrails-2/mutate.sh esc-requires-alt-up docs/evidence/pbt-drag-share/run-ts.sh test/shortcuts.test.ts 2>&1 | grep -E "^✖ Esc|Counterexample|^Mutation" | sort -u
```

```output
  Counterexample: [{"ctrlKey":true,"metaKey":false,"shiftKey":false,"altKey":false},"canvas"]
✖ Esc is a cancel: it matches whatever modifiers are held, in every context it is declared for
Mutation killed (exit 1)
```

```bash
docs/evidence/guardrails-2/mutate.sh esc-requires-alt-up docs/evidence/pbt-drag-share/run-e2e.sh clipboard.spec.ts -g "Esc cancels"
```

```output
1 failed
Mutation killed (exit 1)
```

Mutation 4, a spec creating its own context: `direct-new-context.patch` makes the smoke spec call `browser.newContext()`. The E2E context scan fails on that line:

```bash
docs/evidence/guardrails-2/mutate.sh direct-new-context mix test test/architecture/source_policy_test.exs 2>&1 | grep -E "^ +e2e_contexts |^Mutation" | sed -E "s/^ +//"
```

```output
e2e_contexts e2e/tests/smoke.spec.ts:6: browser context created outside the shared helper: const second = await browser.newContext()
Mutation killed (exit 2)
```

Every file this PR touched outside the evidence folder (A added, M modified) against `duplicate-paste`:

```bash
git diff --name-status duplicate-paste...HEAD -- . ':!docs/evidence' | sort -k2; git diff --shortstat duplicate-paste...HEAD -- . ':!docs/evidence'
```

```output
M	AGENTS.md
M	ARCHITECTURE.md
M	architecture/rules.exs
M	assets/js/generated/manifest.ts
M	assets/js/hooks/clipboard_logic.ts
M	assets/js/hooks/shortcuts.ts
A	assets/test/fixtures/shortcut_parity.json
A	assets/test/shortcut_parity.test.ts
M	assets/test/shortcuts.test.ts
M	assets/test/tools.test.ts
A	docs/adr/0010-registry-declared-shortcut-groups-and-modifier-policy.md
M	e2e/playwright.config.ts
M	e2e/tests/clipboard.spec.ts
M	e2e/tests/collaboration.spec.ts
M	e2e/tests/concurrent-drag.spec.ts
M	e2e/tests/cursors.spec.ts
M	e2e/tests/drag-properties.spec.ts
M	e2e/tests/dragging.spec.ts
M	e2e/tests/export.spec.ts
M	e2e/tests/latency.spec.ts
M	e2e/tests/restart.spec.ts
M	e2e/tests/sessions.spec.ts
M	e2e/tests/shortcuts.spec.ts
M	e2e/tests/smoke.spec.ts
M	e2e/tests/support/canvas.ts
A	e2e/tests/support/contexts.ts
M	e2e/tests/ten-clients.spec.ts
M	lib/mix/tasks/sketch.gen.render_fixtures.ex
M	lib/sketch_web/client_manifest.ex
M	lib/sketch_web/clipboard_actions.ex
M	lib/sketch_web/export_actions.ex
M	lib/sketch_web/fixed_shortcuts.ex
M	lib/sketch_web/history_actions.ex
A	lib/sketch_web/shortcut_fixtures.ex
M	lib/sketch_web/shortcuts.ex
M	lib/sketch_web/shortcuts/aggregate.ex
M	lib/sketch_web/tools.ex
M	lib/sketch_web/zoom_actions.ex
A	test/architecture/fixtures/files/doc_enumerations/ARCHITECTURE.md
A	test/architecture/fixtures/files/doc_enumerations/architecture/rules.exs
A	test/architecture/fixtures/files/doc_enumerations/docs/NOTES.md
A	test/architecture/fixtures/files/doc_enumerations/docs/SPEC.md
A	test/architecture/fixtures/files/e2e_contexts/e2e/tests/direct.spec.ts
A	test/architecture/fixtures/files/e2e_contexts/e2e/tests/support/contexts.ts
A	test/architecture/fixtures/files/e2e_contexts/e2e/tests/support/other.ts
M	test/architecture/source_policy_test.exs
M	test/sketch_web/shortcuts_test.exs
M	test/support/architecture_check.ex
 48 files changed, 1589 insertions(+), 221 deletions(-)
```
