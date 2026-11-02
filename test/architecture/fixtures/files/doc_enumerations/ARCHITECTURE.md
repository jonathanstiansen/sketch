# Fixture architecture

A shortcut goes in its feature's registry, listed by `SketchWeb.Shortcuts.registries/0`.

A shortcut goes in `SketchWeb.Tools`, `HistoryActions`, `ZoomActions` or `ExportActions`.

The point kinds are `line`, `arrow` and `freedraw`.

The drawing tools are `rectangle`, `ellipse` and `eraser`, plus Selection.

The stroke colours are `ink`, `red` and `blue`.

A rectangle and a line are kinds; plain words are not code.

The relayed events are `preview`, `cursor` and `drag_cancel`.

The Selection tool can `toggle`, `marquee` or `resize`.
