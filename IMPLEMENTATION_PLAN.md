# Agent Console — Phase-wise Implementation Plan

> **Target stack:** Next.js 14+ (App Router) · TypeScript strict mode · Tailwind CSS · No AI SDK / streaming helper libraries
> **Backend:** `agent-server` Docker container — do NOT modify it.
> **WebSocket endpoint:** `ws://localhost:4747/ws`

---

## How to Use This Plan

Each phase is self-contained. Hand one phase at a time to the coding agent. Each phase ends with a **verification checklist** — do not move to the next phase until every item passes. File paths are relative to the Next.js project root.

---

## Phase 0 — Project Bootstrap & Scaffolding

### Goal
Create the Next.js project skeleton, configure TypeScript strict mode, set up Tailwind, establish the folder structure, and define every TypeScript type the entire project will use. No logic. No WebSocket. Only structure.

### Steps

#### 0.1 — Create Next.js project

```bash
npx create-next-app@latest agent-console \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"
cd agent-console
```

#### 0.2 — Configure TypeScript strict mode

Edit `tsconfig.json`. Ensure these compiler options are set:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

#### 0.3 — Install dependencies

```bash
npm install zustand immer
npm install -D @types/node
```

- `zustand` — global state store (WebSocket state, messages, timeline, context snapshots)
- `immer` — immutable state updates (required for complex nested state mutations)

No other non-dev runtime dependencies besides what `create-next-app` provides.

#### 0.4 — Establish folder structure

Create these directories (empty, with `.gitkeep`):

```
app/
  page.tsx                    ← root page, layout shell
  layout.tsx                  ← root layout
lib/
  types.ts                    ← ALL shared TypeScript types (see 0.5)
  constants.ts                ← timing constants, config values
  wsProtocol.ts               ← pure functions: parse, validate, serialize messages
  sequenceBuffer.ts           ← SeqBuffer class: ordering + dedup logic
  jsonDiff.ts                 ← pure JSON diff function
store/
  useAgentStore.ts            ← Zustand store (all global state)
hooks/
  useWebSocket.ts             ← WebSocket lifecycle hook
  usePing.ts                  ← Heartbeat / PING-PONG hook
components/
  chat/
    ChatPanel.tsx             ← outer chat container
    MessageBubble.tsx         ← single agent/user message
    TokenStream.tsx           ← renders live streaming tokens
    ToolCallCard.tsx          ← tool call + result card
  timeline/
    TimelinePanel.tsx         ← collapsible side panel
    TimelineRow.tsx           ← single event row
    TokenBatchRow.tsx         ← grouped token row
    TimelineFilter.tsx        ← filter bar
  context/
    ContextPanel.tsx          ← context inspector panel
    ContextTree.tsx           ← JSON tree renderer
    ContextDiff.tsx           ← diff display
    ContextScrubber.tsx       ← history scrubber
  shared/
    ReconnectBanner.tsx       ← non-blocking reconnect indicator
    ConnectionStatus.tsx      ← connection status badge
  layout/
    AppShell.tsx              ← three-panel layout wrapper
__tests__/
  sequenceBuffer.test.ts
  jsonDiff.test.ts
  wsProtocol.test.ts
```

#### 0.5 — Define all TypeScript types in `lib/types.ts`

Create `lib/types.ts` with the following exact types. The coding agent must not use `any` anywhere in the project; all types come from here.

```typescript
// ─── Server → Client message types ────────────────────────────────────────────

export interface TokenMessage {
  type: 'TOKEN';
  seq: number;
  text: string;
  stream_id: string;
}

export interface ToolCallMessage {
  type: 'TOOL_CALL';
  seq: number;
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  stream_id: string;
}

export interface ToolResultMessage {
  type: 'TOOL_RESULT';
  seq: number;
  call_id: string;
  result: Record<string, unknown>;
  stream_id: string;
}

export interface ContextSnapshotMessage {
  type: 'CONTEXT_SNAPSHOT';
  seq: number;
  context_id: string;
  data: Record<string, unknown>;
}

export interface PingMessage {
  type: 'PING';
  seq: number;
  challenge: string;
}

export interface StreamEndMessage {
  type: 'STREAM_END';
  seq: number;
  stream_id: string;
}

export interface ErrorMessage {
  type: 'ERROR';
  seq: number;
  code: string;
  message: string;
}

export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

// ─── Client → Server message types ────────────────────────────────────────────

export interface UserMessageOut {
  type: 'USER_MESSAGE';
  content: string;
}

export interface PongMessage {
  type: 'PONG';
  echo: string;
}

export interface ResumeMessage {
  type: 'RESUME';
  last_seq: number;
}

export interface ToolAckMessage {
  type: 'TOOL_ACK';
  call_id: string;
}

export type ClientMessage = UserMessageOut | PongMessage | ResumeMessage | ToolAckMessage;

// ─── Connection state machine ──────────────────────────────────────────────────

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'tool_call_pending'
  | 'reconnecting'
  | 'resuming'
  | 'closed';

// ─── Application-level domain models ──────────────────────────────────────────

export type ToolCallStatus = 'pending' | 'acked' | 'result_received';

export interface ToolCallRecord {
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result: Record<string, unknown> | null;
  seq: number;
}

export type StreamSegment =
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; call_id: string };

export interface AgentMessage {
  id: string;                     // stream_id
  role: 'assistant';
  segments: StreamSegment[];      // ordered interleaved text + tool call refs
  toolCalls: Record<string, ToolCallRecord>;  // keyed by call_id
  isComplete: boolean;
}

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
}

export type ChatMessage = AgentMessage | UserMessage;

// ─── Timeline event types ──────────────────────────────────────────────────────

export type TimelineEventType =
  | 'token_batch'
  | 'tool_call'
  | 'tool_result'
  | 'context_snapshot'
  | 'ping'
  | 'pong'
  | 'stream_end'
  | 'error'
  | 'reconnect'
  | 'resume';

export interface TimelineEventBase {
  id: string;           // unique local ID
  seq: number;          // from server (0 for client-only events like pong/reconnect)
  timestamp: number;    // Date.now() when processed
  eventType: TimelineEventType;
}

export interface TokenBatchEvent extends TimelineEventBase {
  eventType: 'token_batch';
  stream_id: string;
  tokenCount: number;
  durationMs: number;
  fullText: string;
}

export interface ToolCallEvent extends TimelineEventBase {
  eventType: 'tool_call';
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  stream_id: string;
}

export interface ToolResultEvent extends TimelineEventBase {
  eventType: 'tool_result';
  call_id: string;
  result: Record<string, unknown>;
  stream_id: string;
}

export interface ContextSnapshotEvent extends TimelineEventBase {
  eventType: 'context_snapshot';
  context_id: string;
  snapshotIndex: number;
}

export interface PingEvent extends TimelineEventBase {
  eventType: 'ping';
  challenge: string;
}

export interface PongEvent extends TimelineEventBase {
  eventType: 'pong';
  echo: string;
}

export interface StreamEndEvent extends TimelineEventBase {
  eventType: 'stream_end';
  stream_id: string;
}

export interface ErrorEvent extends TimelineEventBase {
  eventType: 'error';
  code: string;
  message: string;
}

export interface ReconnectEvent extends TimelineEventBase {
  eventType: 'reconnect';
  attempt: number;
}

export interface ResumeEvent extends TimelineEventBase {
  eventType: 'resume';
  last_seq: number;
}

export type TimelineEvent =
  | TokenBatchEvent
  | ToolCallEvent
  | ToolResultEvent
  | ContextSnapshotEvent
  | PingEvent
  | PongEvent
  | StreamEndEvent
  | ErrorEvent
  | ReconnectEvent
  | ResumeEvent;

// ─── Context Inspector ─────────────────────────────────────────────────────────

export interface ContextSnapshotRecord {
  context_id: string;
  seq: number;
  timestamp: number;
  data: Record<string, unknown>;
  snapshotIndex: number;    // 0-based index within this context_id's history
}

// ─── JSON Diff types ───────────────────────────────────────────────────────────

export type DiffType = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffNode {
  key: string;
  diffType: DiffType;
  oldValue?: unknown;
  newValue?: unknown;
  children?: DiffNode[];
}

// ─── Zustand store shape ───────────────────────────────────────────────────────

export interface AgentStoreState {
  // Connection
  connectionState: ConnectionState;
  reconnectAttempt: number;
  lastProcessedSeq: number;           // highest seq fully processed & rendered

  // Chat
  messages: ChatMessage[];
  activeStreamId: string | null;

  // Timeline
  timelineEvents: TimelineEvent[];
  activeTokenBatch: {
    stream_id: string;
    startTime: number;
    tokenCount: number;
    text: string;
  } | null;

  // Context
  contextSnapshots: Record<string, ContextSnapshotRecord[]>;  // keyed by context_id
  contextViewIndex: Record<string, number>;                    // keyed by context_id, current scrubber position

  // Highlight / selection
  highlightedCallId: string | null;
  highlightedTimelineId: string | null;
}
```

#### 0.6 — Define constants in `lib/constants.ts`

```typescript
export const WS_URL = 'ws://localhost:4747/ws';
export const PONG_TIMEOUT_MS = 3000;          // server requires PONG within 3s
export const TOOL_ACK_TIMEOUT_MS = 2000;      // spec says send within 2s
export const RECONNECT_BACKOFF_BASE_MS = 500;
export const RECONNECT_BACKOFF_MAX_MS = 10000;
export const RECONNECT_BACKOFF_MULTIPLIER = 2;
export const RECONNECT_INDICATOR_DELAY_MS = 500;  // show indicator within 500ms
```

### Phase 0 Verification Checklist
- [ ] `npm run build` produces zero TypeScript errors
- [ ] `tsconfig.json` has `"strict": true` and `"noImplicitAny": true`
- [ ] All directories exist as specified
- [ ] `lib/types.ts` compiles without errors and is importable
- [ ] `lib/constants.ts` compiles without errors
- [ ] No `any` appears anywhere in the codebase

---

## Phase 1 — Core Protocol Utilities (Pure Functions + Tests)

### Goal
Implement the three stateless utility modules that all other code depends on: message parsing/validation, the sequence-order buffer, and the JSON diff engine. These have no side effects and must be fully unit-tested before any UI is built.

### Steps

#### 1.1 — `lib/wsProtocol.ts` — Message parsing and serialisation

Implement these exported functions:

**`parseServerMessage(raw: string): ServerMessage | null`**
- Parse raw JSON string
- Validate `type` field is one of the known `ServerMessage` types
- Validate `seq` is a non-negative integer (present on all server messages)
- Return `null` for any malformed input — never throw
- Handle the corrupt PING edge case: `challenge` may be an empty string — this is valid, return the parsed `PingMessage` (empty string challenge is handled at call site, not here)
- Strip unknown extra fields (return only the typed subset)

**`serializeClientMessage(msg: ClientMessage): string`**
- Serialize a `ClientMessage` to a JSON string
- Never throw

**`isKnownMessageType(type: string): type is ServerMessage['type']`**
- Type guard for the discriminated union

#### 1.2 — `lib/sequenceBuffer.ts` — SeqBuffer class

This is the most critical piece of logic. Implement a class `SeqBuffer` with this interface:

```typescript
class SeqBuffer {
  // Insert a message. Ignores duplicates (same seq already seen).
  insert(msg: ServerMessage): void

  // Returns ordered, ready-to-process messages.
  // "Ready" means: seq === lastProcessed + 1 (gapless, in-order)
  // Drains consecutive messages from the buffer and returns them.
  // Updates lastProcessed internally.
  drain(): ServerMessage[]

  // Returns the current lastProcessed seq value.
  getLastProcessed(): number

  // Initialise with a starting seq (for RESUME scenarios).
  // All seqs <= startSeq are considered already processed.
  reset(lastProcessedSeq: number): void
}
```

Implementation details:
- Internally use a `Map<number, ServerMessage>` keyed by `seq` for O(1) lookup and dedup
- `drain()` loops from `lastProcessed + 1` upward, pops from the map, and returns in seq order. Stops as soon as the next expected seq is not present (gap detected — chaos mode out-of-order scenario).
- `reset(n)` clears the map and sets `lastProcessed = n`

#### 1.3 — `lib/jsonDiff.ts` — JSON diff engine

Implement a pure function:

```typescript
function diffJson(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>
): DiffNode[]
```

Rules:
- Returns a flat array of `DiffNode` at the top level, each with optional `children` for nested objects
- For each key in the union of both objects' keys:
  - Key only in `newObj` → `{ diffType: 'added', key, newValue }`
  - Key only in `oldObj` → `{ diffType: 'removed', key, oldValue }`
  - Key in both, values are deeply equal → `{ diffType: 'unchanged', key, newValue }`
  - Key in both, values differ:
    - If both values are plain objects, recurse and put result in `children`
    - Otherwise `{ diffType: 'changed', key, oldValue, newValue }`
- Deep equality: use `JSON.stringify` comparison (sufficient for this use case)
- Must handle the 500KB+ payload without stack overflow: implement iteratively or with a depth limit of 20 levels. At depth > 20, treat as a leaf node (no recursion).

#### 1.4 — `__tests__/sequenceBuffer.test.ts`

Write Jest unit tests covering:
1. Empty buffer — `drain()` returns `[]`
2. Single in-order message — `drain()` returns it, updates lastProcessed
3. Out-of-order: insert seq 3, 1, 2 — `drain()` after all three returns [1, 2, 3]
4. Duplicate seq — inserting the same seq twice, `drain()` returns it once
5. Gap: insert 1, 2, 4 (missing 3) — `drain()` returns [1, 2], holds 4. Insert 3, `drain()` returns [3, 4]
6. `reset(5)` then insert seq 3, 5, 6 — `drain()` returns [6] only (3 and 5 are ≤ lastProcessed)
7. Fully reversed sequence [5,4,3,2,1] — `drain()` after all are inserted returns [1,2,3,4,5]

#### 1.5 — `__tests__/jsonDiff.test.ts`

Write Jest unit tests covering:
1. Both objects identical → all nodes `unchanged`
2. Key added in new → `added` node
3. Key removed → `removed` node
4. Value changed (scalar) → `changed` node with both values
5. Nested object change → `changed` parent with `children` array
6. Empty old, populated new → all `added`
7. Populated old, empty new → all `removed`

#### 1.6 — `__tests__/wsProtocol.test.ts`

Write Jest unit tests covering:
1. Valid TOKEN message parses correctly
2. Valid TOOL_CALL with args parses correctly
3. Valid PING with empty challenge parses as PingMessage (not null)
4. Unknown type returns null
5. Missing `seq` field returns null
6. Malformed JSON string returns null
7. `serializeClientMessage` for each ClientMessage type produces valid parseable JSON

#### 1.7 — Configure Jest

Add Jest config to `package.json`:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/$1"
    }
  }
}
```

Install:
```bash
npm install -D jest ts-jest @types/jest
```

### Phase 1 Verification Checklist
- [ ] `npm test` passes all tests with zero failures
- [ ] SeqBuffer handles all 7 edge cases in tests
- [ ] `diffJson` handles nested objects without stack overflow
- [ ] `parseServerMessage` returns null for malformed input, never throws
- [ ] Empty-challenge PING is parsed successfully (not rejected)

---

## Phase 2 — Zustand Store

### Goal
Implement the single global Zustand store that holds all application state and contains all state mutation logic. Components only read from this store and call its actions — they do not hold local state for anything that crosses component boundaries.

### Steps

#### 2.1 — Create `store/useAgentStore.ts`

Use `zustand` with the `immer` middleware. The store shape matches `AgentStoreState` from `lib/types.ts` exactly.

Implement these actions (exported as part of the store):

---

**Connection actions:**

`setConnectionState(state: ConnectionState): void`
- Sets `connectionState`

`setLastProcessedSeq(seq: number): void`
- Sets `lastProcessedSeq` only if seq > current value

`incrementReconnectAttempt(): void`
- Increments `reconnectAttempt`

`resetReconnectAttempt(): void`
- Sets `reconnectAttempt` to 0

---

**Chat actions:**

`addUserMessage(content: string): void`
- Creates a `UserMessage` with `id = crypto.randomUUID()` and pushes to `messages`

`initAgentStream(stream_id: string): void`
- Creates an empty `AgentMessage` with `id = stream_id`, `segments = []`, `toolCalls = {}`, `isComplete = false`
- Pushes to `messages`
- Sets `activeStreamId = stream_id`

`appendToken(stream_id: string, text: string): void`
- Finds the `AgentMessage` with matching `id`
- If the last segment is `{ kind: 'text' }`, append `text` to its `content`
- Otherwise push a new `{ kind: 'text', content: text }` segment
- Do NOT create a new AgentMessage if none exists for this stream_id — handle gracefully

`addToolCall(msg: ToolCallMessage): void`
- Finds the `AgentMessage` by `stream_id`
- Adds to `toolCalls[call_id] = { call_id, tool_name, args, status: 'pending', result: null, seq: msg.seq }`
- Pushes `{ kind: 'tool_call', call_id }` to `segments`

`ackToolCall(call_id: string): void`
- Finds the `AgentMessage` containing this `call_id` in `toolCalls`
- Sets `toolCalls[call_id].status = 'acked'`

`setToolResult(msg: ToolResultMessage): void`
- Finds the `AgentMessage` by `stream_id`
- Sets `toolCalls[call_id].result = msg.result` and `status = 'result_received'`

`completeStream(stream_id: string): void`
- Finds the `AgentMessage` by `id`
- Sets `isComplete = true`
- Sets `activeStreamId = null`

---

**Timeline actions:**

`flushTokenBatch(): void`
- If `activeTokenBatch` is non-null, creates a `TokenBatchEvent` from it and pushes to `timelineEvents`
- Resets `activeTokenBatch = null`

`addTokenToTimeline(msg: TokenMessage): void`
- If `activeTokenBatch` is null or `activeTokenBatch.stream_id !== msg.stream_id`:
  - Call `flushTokenBatch()` first
  - Set `activeTokenBatch = { stream_id: msg.stream_id, startTime: Date.now(), tokenCount: 1, text: msg.text }`
- Else: increment `tokenCount` and append to `text`

`addTimelineEvent(event: TimelineEvent): void`
- For TOKEN events, use `addTokenToTimeline` instead
- For all others: call `flushTokenBatch()` first (to close any open batch), then push event to `timelineEvents`

---

**Context actions:**

`addContextSnapshot(msg: ContextSnapshotMessage): void`
- Appends to `contextSnapshots[msg.context_id]` (initialise array if first)
- Sets `snapshotIndex` to the 0-based position in the array
- Sets `contextViewIndex[msg.context_id]` to the latest index (auto-advance scrubber)

`setContextViewIndex(context_id: string, index: number): void`
- Sets `contextViewIndex[context_id] = index` (bounds-checked: 0 to array.length - 1)

---

**Highlight / selection actions:**

`setHighlightedCallId(call_id: string | null): void`

`setHighlightedTimelineId(id: string | null): void`

---

**Reset action:**

`resetSession(): void`
- Returns the store to its initial state (all arrays empty, connection idle, seq = -1)
- Call this before sending a first USER_MESSAGE in a fresh session

### Phase 2 Verification Checklist
- [ ] Store compiles with strict TypeScript
- [ ] `appendToken` correctly extends the last text segment rather than creating a new one
- [ ] `addToolCall` creates a tool_call segment AND adds to toolCalls dict
- [ ] `flushTokenBatch` is called before any non-TOKEN timeline event
- [ ] `addContextSnapshot` auto-advances the scrubber index
- [ ] No `any` in store file

---

## Phase 3 — WebSocket Lifecycle Hook

### Goal
Implement the WebSocket connection manager as a React hook. This hook owns the WebSocket instance, the SeqBuffer, the PING/PONG timer, and the reconnection backoff loop. It dispatches every processed server message to the store.

### Steps

#### 3.1 — Create `hooks/useWebSocket.ts`

This is a custom hook. It must NOT be a component. It is called once at the top level of the application (in `AppShell`).

**State machine the hook implements:**

```
idle → connecting → connected → streaming → tool_call_pending
                ↘ reconnecting → connecting (backoff)
                                    ↘ resuming → connected
```

The hook manages:
- A `WebSocket` instance (stored in a `useRef`, NOT in state)
- A `SeqBuffer` instance (stored in a `useRef`, persists across reconnects)
- Reconnect backoff timer (`useRef<ReturnType<typeof setTimeout>>`)
- PONG timeout timer (`useRef<ReturnType<typeof setTimeout>>`)

**`connect(lastSeq: number)` — internal function**

1. Clear any existing backoff timer
2. Set connection state to `'connecting'`
3. Create `new WebSocket(WS_URL)`
4. Assign `ws.onopen`, `ws.onmessage`, `ws.onclose`, `ws.onerror`

**`ws.onopen` handler:**
- Set connection state to `'connected'`
- If `lastSeq >= 0` (this is a reconnect, not fresh connect):
  - Set connection state to `'resuming'`
  - Send `{ type: 'RESUME', last_seq: lastSeq }` — this MUST be the first message sent
  - Add a `ResumeEvent` to the timeline
- Reset reconnect attempt counter

**`ws.onmessage` handler:**
1. Call `parseServerMessage(event.data)` — if null, log and return (never throw)
2. Call `seqBuffer.insert(parsedMsg)`
3. Call `seqBuffer.drain()` to get ordered messages
4. For each drained message, call `processMessage(msg)`
5. After processing, call `store.setLastProcessedSeq(seqBuffer.getLastProcessed())`

**`processMessage(msg: ServerMessage)` — internal function:**

Handle each message type:

- **`TOKEN`:**
  - If no active stream for this `stream_id`, call `store.initAgentStream(msg.stream_id)` first
  - Set connection state to `'streaming'`
  - Call `store.appendToken(msg.stream_id, msg.text)`
  - Call `store.addTokenToTimeline(msg)`

- **`TOOL_CALL`:**
  - Set connection state to `'tool_call_pending'`
  - Call `store.addToolCall(msg)`
  - Add `ToolCallEvent` to timeline
  - Schedule TOOL_ACK: send `{ type: 'TOOL_ACK', call_id: msg.call_id }` within `TOOL_ACK_TIMEOUT_MS` (2000ms). Do NOT send immediately — use `setTimeout(fn, Math.min(200, TOOL_ACK_TIMEOUT_MS))`. After sending, call `store.ackToolCall(msg.call_id)`.
  - Add `PongEvent` (reuse for ACK logging if needed) — actually add an acknowledgement marker to the timeline

- **`TOOL_RESULT`:**
  - Call `store.setToolResult(msg)`
  - Add `ToolResultEvent` to timeline
  - Set connection state back to `'streaming'`

- **`CONTEXT_SNAPSHOT`:**
  - Call `store.addContextSnapshot(msg)`
  - Add `ContextSnapshotEvent` to timeline

- **`PING`:**
  - Add `PingEvent` to timeline
  - Respond immediately (do not defer): if `msg.challenge` is empty string, respond with `echo: ''` — do NOT crash or skip
  - Send `{ type: 'PONG', echo: msg.challenge }`
  - Add `PongEvent` to timeline
  - Clear and reset the PONG watchdog timer

- **`STREAM_END`:**
  - Call `store.completeStream(msg.stream_id)`
  - Call `store.flushTokenBatch()` (close any open token batch in timeline)
  - Add `StreamEndEvent` to timeline
  - Set connection state to `'connected'`

- **`ERROR`:**
  - Add `ErrorEvent` to timeline
  - Log to console

**`ws.onclose` / `ws.onerror` handler (same logic for both):**
1. Log the event
2. Flush any open token batch in timeline
3. If connection was not intentionally closed (check a `intentionalClose` ref):
   - Set connection state to `'reconnecting'`
   - Increment reconnect attempt
   - Add `ReconnectEvent` to timeline
   - Schedule reconnect with exponential backoff:
     ```
     delay = min(BASE * (2 ^ attempt), MAX_BACKOFF)
     ```
     Where attempt is 0-indexed. Delays: 500ms, 1000ms, 2000ms, 4000ms, 8000ms, 10000ms (capped).
   - After delay, call `connect(store.lastProcessedSeq)`

**Hook return value:**

```typescript
return {
  send: (msg: ClientMessage) => void,  // sends serialized message if ws is OPEN
  disconnect: () => void,              // sets intentionalClose=true, closes ws
  connectionState: ConnectionState,    // read from store
}
```

**Cleanup:** `useEffect` cleanup must close the WebSocket and clear all timers.

#### 3.2 — Create `hooks/usePing.ts`

This hook manages a watchdog for missed PINGs. The server drops the connection after 3 missed PONGs.

- Start a timer when the WebSocket connects
- If no PING is received for 15 seconds, log a warning (but do NOT close the connection — the server controls that)
- Reset the timer on every PING received
- This is informational only — the actual PONG response is sent in `useWebSocket.ts`

### Phase 3 Verification Checklist
- [ ] On initial connect, NO `RESUME` is sent
- [ ] On reconnect, `RESUME` is the very first message sent
- [ ] Empty-challenge PING results in a PONG with `echo: ''` (not a crash)
- [ ] Reconnect uses exponential backoff: 500 → 1000 → 2000 → 4000 → 8000 → 10000 (capped)
- [ ] Duplicate seq messages are silently ignored (SeqBuffer handles dedup)
- [ ] Out-of-order messages are held until gaps are filled
- [ ] `TOOL_ACK` is sent within 2000ms of every `TOOL_CALL`
- [ ] All timers are cleared in `useEffect` cleanup

---

## Phase 4 — Chat Panel

### Goal
Build the chat panel. This is the primary visible output. Tokens render incrementally. Tool calls interrupt the stream without layout shift. Multiple tool calls chain correctly.

### Steps

#### 4.1 — `components/chat/TokenStream.tsx`

A component that receives `stream_id: string` as a prop and reads the corresponding `AgentMessage` from the store.

- Render the `segments` array in order
- For `{ kind: 'text' }` segments: render as `<span>` with `white-space: pre-wrap`
- For `{ kind: 'tool_call' }` segments: render `<ToolCallCard call_id={...} />`
- A blinking cursor appears at the end when `isComplete === false`
- When a new text character is appended to the last segment, the component re-renders only the changed span — use `React.memo` on individual segment renderers to avoid full re-render of the segment list

**Critical — no layout shift rule:**
- The container `div` for the token stream must have `min-height` set to its content height BEFORE a tool call arrives. The technique: use CSS `contain: layout` on the streaming text container so tool card insertion below does not cause the text above to reflow.
- Tool call cards are rendered BELOW the text frozen at the `tool_call` segment insertion point — they never push existing text upward.

#### 4.2 — `components/chat/ToolCallCard.tsx`

Receives `call_id: string` and reads `ToolCallRecord` from the store.

Renders:
- Tool name in a monospaced header
- Args as a collapsed JSON tree (use `<pre>` with `overflow-x: auto`)
- Status badge: "Pending" (yellow) → "Acknowledged" (blue) → "Result Received" (green)
- When `status === 'result_received'`: expand the card to show the result object
- The card is wrapped in a `div` with `data-call-id={call_id}` attribute for scroll-targeting from timeline
- On click: call `store.setHighlightedCallId(call_id)` and `store.setHighlightedTimelineId(...)` (bidirectional highlight)
- Visually highlighted when `store.highlightedCallId === call_id`

#### 4.3 — `components/chat/MessageBubble.tsx`

Receives a `ChatMessage` and renders either:
- User message: right-aligned bubble with the content text
- Agent message: left-aligned, renders `<TokenStream stream_id={...} />`

#### 4.4 — `components/chat/ChatPanel.tsx`

- Renders the list of `store.messages` using `MessageBubble`
- Auto-scrolls to bottom when a new message is added (but NOT on every token — check if user has manually scrolled up first using a ref tracking scroll position)
- Input box at the bottom:
  - Textarea with `onKeyDown` handler: Enter (without Shift) submits
  - On submit: call `store.addUserMessage(content)`, call `ws.send(userMessageOut)`
  - Disable input while `connectionState === 'reconnecting'`

### Phase 4 Verification Checklist
- [ ] Tokens appear character-by-character in real time without batching
- [ ] When TOOL_CALL arrives, frozen text does not move or reflow
- [ ] Tool call card appears below frozen text
- [ ] Tool card status badge updates from pending → acked → result_received
- [ ] Two sequential tool calls both render as stacked cards (not overwriting)
- [ ] Streaming resumes after TOOL_RESULT from exactly where it paused
- [ ] Auto-scroll works but does not fight user manual scroll
- [ ] Input is disabled during reconnect

---

## Phase 5 — Agent Trace Timeline

### Goal
Build the collapsible trace timeline panel with batched token rows, linked tool call/result pairs, bidirectional highlight, filter bar, and jank-free rendering at 30+ events/second.

### Steps

#### 5.1 — `components/timeline/TimelineRow.tsx`

Base row component for all non-token events. Receives a `TimelineEvent` and renders:
- Timestamp (relative: "0.3s ago")
- Event type badge (color-coded by type)
- Summary text (e.g., "TOOL_CALL: lookup_metric", "PING: a1b2c3", "ERROR: …")
- For `tool_call` and `tool_result` events with the same `call_id`: render an indent + left-border line to visually link them
- `data-timeline-id={event.id}` attribute for scroll-targeting
- On click: call `store.setHighlightedTimelineId(event.id)` and, if the event has a `call_id`, also `store.setHighlightedCallId(call_id)` (bidirectional)
- Highlighted when `store.highlightedTimelineId === event.id`

#### 5.2 — `components/timeline/TokenBatchRow.tsx`

Renders a `TokenBatchEvent`:
- Collapsed: "Streamed N tokens (X.Xs)" with a chevron
- Expanded: shows `fullText` in a scrollable `<pre>` block
- Toggle expand/collapse with local `useState` — this does NOT go in global store
- `React.memo` to prevent re-render unless the event itself changes (events are immutable once added)

#### 5.3 — `components/timeline/TimelineFilter.tsx`

A filter bar component with:
- Multi-select checkboxes for each `TimelineEventType` (all checked by default)
- Text search input
- Filter logic is applied inside `TimelinePanel` via `useMemo` — not in the store

#### 5.4 — `components/timeline/TimelinePanel.tsx`

**Performance requirement:** The full timeline list must NOT re-render on every new token. Implement as follows:

- Use `useRef` for the scroll container
- Subscribe to `store.timelineEvents` with a stable selector. The list re-renders when events are added, but individual row components are memoized.
- Apply filter/search via `useMemo` that depends on the events array and filter state — recomputes only when events change or filter changes.
- Auto-scroll to bottom only when the user has not manually scrolled up (same pattern as ChatPanel).
- When `store.highlightedTimelineId` changes: `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` on the target `data-timeline-id` element.

#### 5.5 — Collapsible panel

- Timeline panel is collapsible via a toggle button
- When collapsed: shows only an icon strip
- When expanded: full panel width (350px)
- Transition with CSS `transition: width 200ms ease`

### Phase 5 Verification Checklist
- [ ] No visible jank when tokens arrive at 30+/second (timeline should not re-render per-token)
- [ ] Token rows are grouped ("Streamed 47 tokens") not one-per-token
- [ ] TOOL_CALL and TOOL_RESULT rows with same call_id are visually linked (indent + line)
- [ ] Clicking a timeline row highlights the corresponding element in chat
- [ ] Clicking a ToolCallCard in chat scrolls the timeline to its TOOL_CALL row
- [ ] Filter bar hides/shows event types correctly
- [ ] Text search filters by event summary content
- [ ] Timeline auto-scrolls to latest event unless user has scrolled up

---

## Phase 6 — Context Inspector

### Goal
Build the context inspector: a JSON tree renderer with diff highlighting between snapshots, and a history scrubber to step through the snapshot sequence.

### Steps

#### 6.1 — `components/context/ContextTree.tsx`

A recursive component that renders `Record<string, unknown>` as an interactive tree.

- Each node has a toggle (expand/collapse) with local state in a `useReducer` at the tree root (a `Set<string>` of expanded key paths)
- Key paths are dot-separated (e.g., `"report.sections.0"`)
- Values are rendered as:
  - `string`: `"…"` in green
  - `number`: in blue
  - `boolean`: `true`/`false` in orange
  - `null`: `null` in gray
  - `array`: `[N items]` collapsed, expanded as indexed children
  - `object`: `{N keys}` collapsed, expanded as keyed children
- **Performance for 500KB payloads:** Never recursively render more than the visible expanded nodes. Non-expanded nodes render only their summary line (key + type + count). Use `React.memo` on each tree node. The DOM node count stays proportional to expanded depth, not total data size.
- Each node is colored by its `diffType` when `diffNode` is provided as a prop:
  - `added`: green background tint
  - `removed`: red background tint with strikethrough
  - `changed`: yellow background tint
  - `unchanged`: no tint

#### 6.2 — `components/context/ContextDiff.tsx`

Receives `prev: Record<string, unknown>` and `curr: Record<string, unknown>`.
- Calls `diffJson(prev, curr)` (memoized with `useMemo`)
- Passes `diffNodes` down to `ContextTree`
- Shows a summary: "N added · M removed · P changed"

#### 6.3 — `components/context/ContextScrubber.tsx`

Receives `context_id: string`.
- Reads the history array from `store.contextSnapshots[context_id]`
- Reads `store.contextViewIndex[context_id]`
- Renders a horizontal slider (HTML `<input type="range">`)
- Prev/Next buttons
- "Snapshot N of M" label
- On change: calls `store.setContextViewIndex(context_id, newIndex)`

#### 6.4 — `components/context/ContextPanel.tsx`

- Lists all known `context_id`s as tabs
- For selected `context_id`:
  - Shows `ContextScrubber`
  - If `viewIndex === 0` (first snapshot): shows `ContextTree` without diff
  - If `viewIndex > 0`: shows `ContextDiff` with `prev = snapshots[viewIndex - 1].data` and `curr = snapshots[viewIndex].data`
  - Shows raw seq and timestamp for the current snapshot

### Phase 6 Verification Checklist
- [ ] JSON tree renders without freezing for 500KB payload (only expanded nodes in DOM)
- [ ] Diff highlighting shows added/removed/changed nodes correctly
- [ ] Scrubber steps backward and forward through snapshot history
- [ ] Diff summary "N added · M removed · P changed" is accurate
- [ ] Multiple context_id tabs work independently
- [ ] First snapshot shows no diff (no previous to compare)

---

## Phase 7 — Reconnection UI & Connection Status

### Goal
Build the non-blocking reconnection indicator, the connection status badge, and wire up the complete application shell.

### Steps

#### 7.1 — `components/shared/ReconnectBanner.tsx`

- Renders only when `connectionState === 'reconnecting'`
- Appears within 500ms of disconnect: use `useEffect` that starts a 500ms timer. If still `reconnecting` after 500ms, set local `visible` state to true.
- Non-blocking: positioned as a fixed top banner or a small corner toast — does NOT overlay or disable the chat panel
- Shows: "Reconnecting… (attempt N)" with a spinner
- When `connectionState` changes away from `'reconnecting'`: fade out and hide

#### 7.2 — `components/shared/ConnectionStatus.tsx`

- Small status badge in the header
- Shows: Idle / Connecting / Connected / Streaming / Reconnecting / Resuming
- Color coded: green (connected/streaming), yellow (connecting/resuming), red (reconnecting)

#### 7.3 — `components/layout/AppShell.tsx`

Three-column layout:
- Left: `TimelinePanel` (collapsible, 350px expanded / 48px collapsed)
- Center: `ChatPanel` (flex-grow)
- Right: `ContextPanel` (320px fixed)
- Header row: app title, `ConnectionStatus`, reset button
- `ReconnectBanner` overlaid at top

Calls `useWebSocket()` once here — the hook is mounted at this level and lives for the app lifetime.

#### 7.4 — `app/page.tsx`

```tsx
import AppShell from '@/components/layout/AppShell';

export default function Home() {
  return <AppShell />;
}
```

#### 7.5 — `app/layout.tsx`

Standard root layout with:
- `<html lang="en">`
- `<body className="...">` (dark background recommended for the terminal aesthetic)
- Import global CSS

### Phase 7 Verification Checklist
- [ ] Reconnect banner appears within 500ms of disconnect
- [ ] Chat panel remains scrollable and readable during reconnect
- [ ] Chat input is disabled during `reconnecting` state
- [ ] Banner disappears once connected
- [ ] Connection status badge accurately reflects the state machine
- [ ] Three-panel layout renders correctly at 1280px+ viewport width
- [ ] App builds: `npm run build` succeeds with zero errors

---

## Phase 8 — Chaos Mode Hardening

### Goal
Audit every component against the chaos mode failure scenarios from the spec. Fix any remaining edge cases. This phase is about review and hardening, not new features.

### Steps

#### 8.1 — Chaos scenario audit: Connection drop mid-stream

**What to verify:**
- When `ws.onclose` fires mid-stream, `store.flushTokenBatch()` is called so the open token batch is closed
- The `AgentMessage` for the interrupted stream remains in `store.messages` with `isComplete = false`
- Any pending `ToolCallRecord` with `status: 'pending'` or `'acked'` remains visible in the ToolCallCard with "waiting" state
- On reconnect + RESUME, replayed `TOOL_RESULT` events correctly call `store.setToolResult()`
- Replayed `TOKEN` events correctly call `store.appendToken()` — they must not re-create the `AgentMessage` if it already exists (check `initAgentStream` is guarded by an existence check)

**Fix required:** In `store.initAgentStream`, add: if an `AgentMessage` with this `stream_id` already exists in `messages`, do NOT create a duplicate. Simply set `activeStreamId = stream_id`.

#### 8.2 — Chaos scenario audit: Out-of-order delivery

**What to verify:**
- SeqBuffer `insert` + `drain` handles fully reversed sequences
- The `ws.onmessage` handler always calls `drain()` after every `insert()`, not just when a message is "expected"
- No assumptions anywhere in processMessage that messages arrive in order — the SeqBuffer guarantees order by the time processMessage is called

#### 8.3 — Chaos scenario audit: Rapid tool calls

**What to verify:**
- Two `TOOL_CALL` events with different `call_id`s for the same `stream_id` before any `TOOL_RESULT`
- Both must appear as separate `ToolCallRecord` entries in `toolCalls`
- Both must have `{ kind: 'tool_call' }` segments in `segments`
- `TOOL_ACK` must be sent for each `call_id` separately
- When both `TOOL_RESULT`s arrive, both cards update to show results
- Token streaming that resumes after the second result must continue from the right point

#### 8.4 — Chaos scenario audit: Oversized context snapshot

**What to verify:**
- A 500KB `CONTEXT_SNAPSHOT` is parsed without throwing (JSON.parse handles arbitrary sizes)
- `store.addContextSnapshot` stores the data by reference — no copying or deep-cloning
- `ContextTree` renders the top-level keys without recursing into collapsed nodes
- `diffJson` with a 500KB object must not stack-overflow — verify the depth-limit guard in `lib/jsonDiff.ts`

**Fix required if needed:** Wrap `JSON.parse` in wsProtocol.ts in a try/catch for oversized payloads. In `diffJson`, ensure the recursion depth guard from Phase 1 is present.

#### 8.5 — Chaos scenario audit: Corrupt heartbeat

**What to verify:**
- `parseServerMessage` returns a valid `PingMessage` with `challenge: ''` for an empty-challenge PING
- `processMessage` for PING with empty `challenge`: sends `{ type: 'PONG', echo: '' }` — does NOT skip, crash, or disconnect
- PONG watchdog timer is reset even for empty-challenge PINGs

#### 8.6 — Chaos scenario audit: Duplicate messages

**What to verify:**
- SeqBuffer `insert` silently ignores a message with a `seq` already in its map
- Already-processed seqs (≤ lastProcessed) are also ignored on RESUME replay

#### 8.7 — Protocol compliance audit

Run the agent server in normal mode, send several messages, then hit `GET http://localhost:4747/log`. Verify:
- All `PONG` entries have `verdict: "ok"` (no missed or late PONGs)
- All `TOOL_ACK` entries have `verdict: "ok"` (no missed or late ACKs)
- All `RESUME` entries have `verdict: "ok"` (correct `last_seq` sent)
- No `verdict: "violation"` or `verdict: "error"` entries

### Phase 8 Verification Checklist
- [ ] `/log` shows all `"ok"` verdicts in normal mode
- [ ] `initAgentStream` does not create duplicate AgentMessages on RESUME replay
- [ ] Empty-challenge PING handled without crash or disconnect
- [ ] Rapid tool calls produce two stacked, independent cards
- [ ] 500KB context snapshot does not freeze the browser tab
- [ ] Duplicate seq messages handled by SeqBuffer dedup

---

## Phase 9 — Documentation & Deliverables

### Goal
Write all required documentation. This phase is not optional — per the spec, incomplete docs result in rejection.

### Steps

#### 9.1 — `README.md`

Write a README containing exactly these sections:

**1. Architectural Summary (2–3 sentences)**
Describe: Zustand store as single source of truth, SeqBuffer for out-of-order dedup, WebSocket hook as the protocol state machine.

**2. WebSocket State Machine Diagram**

Write this as an ASCII or Mermaid diagram covering all states and transitions:

```
idle → connecting
connecting → connected (ws.onopen, no last_seq)
connecting → resuming (ws.onopen, last_seq > -1, sends RESUME)
resuming → connected (after replayed events processed)
connected → streaming (first TOKEN received)
streaming → tool_call_pending (TOOL_CALL received)
tool_call_pending → streaming (TOOL_RESULT received)
streaming → connected (STREAM_END received)
[any state] → reconnecting (ws.onclose / ws.onerror, not intentional)
reconnecting → connecting (after backoff delay)
[any state] → closed (intentional disconnect)
```

**3. How to Run**

```bash
# Start backend
cd agent-server
docker build -t agent-server .
docker run -p 4747:4747 agent-server

# In a new terminal, start frontend
cd agent-console
npm install
npm run dev
# Open http://localhost:3000

# Chaos mode
docker run -p 4747:4747 agent-server --mode chaos
```

**4. Screenshots**
Include three screenshots:
- (a) A streamed response with a tool call card visible
- (b) The trace timeline panel showing mixed event types
- (c) The context inspector showing a diff between two snapshots

#### 9.2 — `DECISIONS.md`

Write this file with the following sections:

**1. Seq-based ordering and deduplication**
- Data structure chosen: `Map<number, ServerMessage>` — O(1) insert and lookup, O(k) drain where k = consecutive ready messages
- `drain()` loop: start from lastProcessed+1, pop and return in order, stop at first gap
- Dedup: `Map.has(seq)` check on insert — existing entry is not overwritten
- Why not an array + sort: sort is O(n log n) on every drain; Map approach is O(k) amortized

**2. Preventing layout shift during tool call interruptions**
- `segments` array preserves the interleave point: text segment is frozen (no new tokens added to it once TOOL_CALL arrives), tool_call segment is inserted next
- `appendToken` only extends the LAST text segment if it's already a `{ kind: 'text' }` — a new text segment is started after TOOL_RESULT resumes
- CSS: streaming text container uses `contain: layout` to isolate it from card insertion below
- Tool cards are appended after the text node in the DOM, never inserted before it

**3. State recovery after reconnection**
- `lastProcessedSeq` tracks the highest seq for which `processMessage` completed (not just arrived at the socket)
- SeqBuffer `getLastProcessed()` is authoritative — this is what goes into the RESUME message
- RESUME is sent as the first message on reconnection, before any user input is enabled
- On replayed events: SeqBuffer dedup ensures already-processed seqs are ignored; `initAgentStream` guard ensures no duplicate messages are created in the store

**4. 50 concurrent agent streams (operations dashboard)**
- Replace single Zustand store with a stream-indexed slice: `streams: Record<stream_id, StreamState>`
- Replace global `timelineEvents` with per-stream timelines, virtualised with `react-virtual`
- WebSocket hook becomes a pool: one WS per stream, or a multiplexed connection if the backend supports it
- SeqBuffer must be per-stream (seq spaces may collide across streams if the backend uses stream-local seq)
- Layout: CSS Grid with fixed-height stream cells, virtualised scrolling for the stream list

**5. 100x longer responses (full document generation)**
- `segments` array could hold tens of thousands of text chunks — collapse consecutive text segments into a single large `content` string periodically (a "compact" action in the store, triggered every 500 tokens)
- Token streaming renderer must use windowed rendering (react-virtual or custom) — only render visible lines
- Timeline token batches already handle this (one batch row per stream period, not per token)
- For the context inspector, the depth-limit in `diffJson` becomes more important; add a "load more" control for deep nesting

**6. Known failure mode in the protocol (TOOL_ACK race condition)**
The spec states: the server waits for `TOOL_ACK` before sending `TOOL_RESULT`, but times out after 5 seconds and sends `TOOL_RESULT` anyway, logging a protocol violation. The race condition: if the client sends `TOOL_ACK` just after the 5-second server timeout, the server has already sent `TOOL_RESULT`. The client then receives `TOOL_RESULT` before its own `TOOL_ACK` send completes. This is benign on the client side (ToolCallRecord status goes from pending → result_received, skipping 'acked'), but the server log records a violation even though the client did send the ACK. There is no way for the client to avoid this without the server exposing the timeout deadline — a protocol gap.

#### 9.3 — Chaos mode screen recording

Record 3–5 minutes in chaos mode showing (label each event on screen using browser DevTools or a text overlay):
1. Connection drop mid-stream → reconnect → response continues
2. Out-of-order tokens → correct final text
3. Rapid tool calls → two stacked cards
4. 500KB context snapshot → panel stays responsive
5. Corrupt heartbeat PING → no crash, PONG sent

Upload to YouTube (unlisted) or Loom. Include URL in the submission email.

### Phase 9 Verification Checklist
- [ ] `README.md` has all four sections including state machine diagram
- [ ] `DECISIONS.md` addresses all five questions from the spec plus the TOOL_ACK race condition
- [ ] Screenshots are accurate (taken from the running app, not fabricated)
- [ ] Screen recording covers all five chaos scenarios
- [ ] `npm run build` still passes after documentation is committed

---

## Phase 10 — Final Integration Test

### Goal
End-to-end test of the complete application against the real agent-server. Run the full protocol compliance check.

### Steps

#### 10.1 — Normal mode protocol compliance

```bash
docker run -p 4747:4747 agent-server
```

1. Open the app at `http://localhost:3000`
2. Send: "hello" → verify basic streaming
3. Send: "report summary" → verify one tool call with card
4. Send: "analyze compare" → verify two sequential tool calls
5. Send: "large database schema" → verify oversized context in inspector
6. Kill the Docker container mid-stream → verify reconnect banner appears → restart container → verify RESUME and state recovery

```bash
curl -s http://localhost:4747/log | python3 -m json.tool
```

All entries must have `"verdict": "ok"`.

#### 10.2 — Chaos mode survival test

```bash
docker run -p 4747:4747 agent-server --mode chaos
```

1. Send multiple messages and let chaos mode run for 3–5 minutes
2. The app must not crash, white-screen, or throw unhandled exceptions
3. The chat panel must remain readable and scrollable at all times
4. All PONG and TOOL_ACK entries in `/log` must be `"ok"`

#### 10.3 — Final build check

```bash
npm run build
npm run test
```

Both must pass with zero errors.

#### 10.4 — TypeScript audit

```bash
npx tsc --noEmit
```

Must produce zero errors. `grep -r "any" lib/ store/ hooks/ components/` must produce zero results.

### Phase 10 Verification Checklist
- [ ] `/log` shows all `"ok"` verdicts in normal mode
- [ ] App does not crash in chaos mode over 3+ minutes
- [ ] `npm run build` passes
- [ ] `npm test` passes all unit tests
- [ ] `npx tsc --noEmit` shows zero errors
- [ ] No `any` in source files
- [ ] Screen recording captured and upload URL in hand

---

## Summary: Phase Execution Order

| Phase | What it produces | Prerequisite |
|---|---|---|
| 0 | Project skeleton + all types + constants | Nothing |
| 1 | Pure utility functions + unit tests | Phase 0 |
| 2 | Zustand store with all actions | Phase 0, 1 |
| 3 | WebSocket hook (no UI) | Phase 0, 1, 2 |
| 4 | Chat panel (streaming + tool calls) | Phase 0, 2, 3 |
| 5 | Timeline panel | Phase 0, 2, 3 |
| 6 | Context inspector | Phase 0, 1, 2 |
| 7 | Layout shell + reconnect UI | Phase 0, 2, 3, 4, 5, 6 |
| 8 | Chaos hardening (review + fixes) | Phase 3, 4, 5, 6, 7 |
| 9 | README, DECISIONS.md, recording | Phase 8 |
| 10 | Final integration test | Phase 9 |

---

## Escape Hatch File Policy

Per the spec: no `any` types except in a single documented escape hatch file. Create `lib/typeEscapeHatch.ts` with:

```typescript
/**
 * ESCAPE HATCH — The only file in this project permitted to use `any`.
 * Each usage must be documented with a comment explaining why it is unavoidable.
 * 
 * Current usages: NONE.
 * 
 * If you need to add one: document the reason, add a TODO to fix it, and
 * ping the reviewer to discuss before merging.
 */

// No usages currently. Add here only if truly unavoidable.
```

This file exists to make the policy visible, not to grant permission to use `any`.

---

*End of Implementation Plan*
