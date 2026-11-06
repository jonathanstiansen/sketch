import { pushClientEvent } from "./client_events.ts"

export function erase(server: { pushEvent(event: string, payload: object): Promise<unknown> }, ids: string[]): Promise<unknown> {
  return pushClientEvent(server, "erase", { element_ids: ids })
}
