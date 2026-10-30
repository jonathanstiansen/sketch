export function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "z") undo()
  if (event.code !== "KeyE") return
  if ("Escape" === event.key) close()
  if (event.key.toLowerCase() == "y") redo()
  switch (event.key) {
    default:
  }
  if (["Delete", "Backspace"].includes(event.key)) erase()
  if (pressedKey === "d") draw()
}
