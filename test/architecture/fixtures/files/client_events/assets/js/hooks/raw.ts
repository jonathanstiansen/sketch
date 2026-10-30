export function selectionChanged(hook: { pushEvent(event: string, payload: object): Promise<unknown>; pushEventTo(target: string, event: string, payload: object): Promise<unknown> }, selected: string[]): void {
  void hook.pushEvent("selection_changed", { selected })
  void hook.pushEventTo("#canvas", "selection_changed", { selected })
}
