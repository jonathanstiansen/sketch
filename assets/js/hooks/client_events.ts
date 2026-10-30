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
