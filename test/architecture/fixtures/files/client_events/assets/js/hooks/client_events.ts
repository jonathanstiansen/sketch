export function pushClientEvent(hook: { pushEvent(event: string, payload: object): Promise<unknown> }, event: string, payload: object): Promise<unknown> {
  return hook.pushEvent(event, payload)
}
