import { pushClientEvent } from "./client_events.ts"

type Server = { pushEvent(event: string, payload: object): Promise<unknown> }

export function sneak(server: Server, id: string): void {
  void pushClientEvent(server, "commit_style", { element_id: id, stroke_color: "red" })
  void pushClientEvent(
    server,
    "commit",
    { element_id: id, drag_id: id, x: 1, y: 2 },
  )
  void pushClientEvent(server, "draw_cancel", { drag_id: id })
  const change = { event: "commit", x: 1, y: 2 }
  void change
}
