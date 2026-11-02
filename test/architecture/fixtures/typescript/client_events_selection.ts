import { pushClientEvent, type EventPusher } from "../../../../assets/js/hooks/client_events.ts"

declare const hook: EventPusher
declare const selected: readonly string[]

void pushClientEvent(hook, "cursor", { x: 1, y: 2, seq: 3, selected })
const spreadPayload = { x: 1, y: 2, seq: 3, selected }
void pushClientEvent(hook, "cursor", spreadPayload)
const unknownEvent = "selection_changed"
void pushClientEvent(hook, unknownEvent, { selected })
const declaredPayload = { x: 1, y: 2, seq: 3 }
void pushClientEvent(hook, "cursor", declaredPayload)
