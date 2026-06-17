# Design Decisions

This document records every significant design decision made during implementation, including alternatives considered and the rationale for the choice made.

---

## 1. Seq-based ordering and deduplication

**Data structure chosen:** `Map<number, ServerMessage>` stored in `lib/sequenceBuffer.ts`.

- **O(1) insert and lookup**: `Map.set(seq, msg)` and `Map.has(seq)` are constant time regardless of buffer size.
- **O(k) drain**: The `drain()` loop increments from `lastProcessed + 1` and pops in order, stopping at the first gap. `k` is the number of consecutively-ready messages — the common case is `k = 1` (ordered delivery), so drain is effectively O(1) per message in normal operation.
- **Deduplication**: `insert()` checks `map.has(seq)` before setting. An existing entry is **not overwritten** — the first-seen copy wins. Already-processed seqs (`seq ≤ lastProcessed`) are also rejected on entry, so RESUME replays of already-applied events are silently ignored.
- **Why not an array + sort**: Sorting on every drain is O(n log n) where n is the current buffer size. In chaos mode with 100+ out-of-order messages, this compounds badly. The Map approach reduces drain to O(k) amortized, where k ≪ n.

---

## 2. Preventing layout shift during tool call interruptions

When a `TOOL_CALL` message interrupts a token stream, the text above must not move.

- **`segments` array preserves the interleave point**: Each `AgentMessage` holds a `segments: StreamSegment[]` array. When `TOOL_CALL` arrives, `addToolCall` pushes a `{ kind: 'tool_call', call_id }` segment. The previous text segment is frozen — `appendToken` only extends the **last** segment if it is already `{ kind: 'text' }`. After `TOOL_RESULT`, new tokens create a fresh `{ kind: 'text' }` segment, so the text picks up exactly where it paused.
- **CSS containment**: The streaming text container in `TokenStream.tsx` uses `contain: layout`. This instructs the browser's layout engine to treat the container as an isolated formatting context, so inserting a `ToolCallCard` **below** it cannot reflow the text above.
- **DOM order guarantee**: `SegmentList` renders segments in array index order. Tool cards are always appended **after** the text node in the DOM — they never shift existing text upward.

---

## 3. State recovery after reconnection

- **`lastProcessedSeq`** in the store tracks the highest seq for which `processMessage` fully completed — not merely the highest seq received. This distinction matters: a message that arrived but was held in the SeqBuffer while waiting for a gap to fill must not be counted until it drains and processes.
- **`SeqBuffer.getLastProcessed()`** is the single authoritative source for the `last_seq` field sent in `RESUME`. This is read from `store.lastProcessedSeq` in `useWebSocket.ts`, which is updated via `store.setLastProcessedSeq(seq)` at the end of each `processMessage` call.
- **RESUME is the first message sent on reconnect**: Inside `ws.onopen`, before any user input is re-enabled, the hook checks `lastSeq ≥ 0` and sends `{ type: 'RESUME', last_seq }` as the very first outgoing frame.
- **Replay safety**: SeqBuffer dedup ensures already-processed seqs are silently dropped. `initAgentStream` in the store contains an existence guard (Phase 8.1 fix): if an `AgentMessage` with the replayed `stream_id` already exists, it sets `activeStreamId` without creating a duplicate entry.

---

## 4. 50 concurrent agent streams (operations dashboard)

If extended to monitor 50 simultaneous streams:

- **Store**: Replace the current flat `messages[]` and single `activeStreamId` with a `streams: Record<stream_id, StreamState>` slice. Each `StreamState` contains its own `messages`, `toolCalls`, `activeTokenBatch`, and `timelineEvents`. This prevents any single slow stream from blocking renders for others.
- **Timeline**: Replace the global `timelineEvents` array with per-stream timelines. Render the visible stream's timeline only. For the aggregate view (all 50 streams), use `react-virtual` or `@tanstack/virtual` for windowed rendering — a flat list of 50 × N events is too large to render in the DOM.
- **WebSocket**: The `useWebSocket` hook becomes a pool: one `WebSocket` instance per stream, or a single multiplexed connection if the backend uses a stream-ID envelope at the transport layer. Each connection has its own `SeqBuffer` — seq namespaces may collide across streams if the server uses stream-local seq numbering.
- **Layout**: CSS Grid with fixed-height stream cells (e.g., 200 px each), virtualised scrolling for the stream list. Only the focused stream's `ChatPanel` renders at full fidelity; others show a collapsed summary card.

---

## 5. 100x longer responses (full document generation)

If responses become 100× longer (tens of thousands of tokens per stream):

- **`segments` compaction**: The `segments` array could accumulate thousands of `{ kind: 'text' }` entries over a long stream. A `compactStream` store action, triggered every 500 tokens, merges consecutive text segments into a single large `content` string. This keeps the `segments` array short (O(tool_calls) entries) without losing content.
- **Windowed rendering**: The `SegmentList` in `TokenStream.tsx` must be replaced with a virtualised renderer (`react-virtual` or equivalent). Only the visible viewport of text is in the DOM; invisible segments are measured but not mounted.
- **Timeline**: The existing `TokenBatchRow` design already handles this correctly — one collapsed row per batch period, not one per token. No change needed.
- **Context inspector**: For deeply nested 500 KB+ context objects, the `diffJson` depth limit (`MAX_DEPTH = 20`) becomes more important. A "Load more" control on collapsed deep nodes prevents the tree from ever rendering more nodes than the screen can show.

---

## 6. Known failure mode in the protocol — TOOL_ACK race condition

The spec states: the server waits for `TOOL_ACK` before sending `TOOL_RESULT`, but times out after 5 seconds and sends `TOOL_RESULT` anyway, logging a protocol violation.

**The race**: if the client sends `TOOL_ACK` just before the 5-second server timeout expires, the server may have already dispatched `TOOL_RESULT`. The client then receives `TOOL_RESULT` before its own `TOOL_ACK` send completes (or before the server registers the ACK).

**Client-side behaviour**: Benign. The `ToolCallRecord` status transitions `pending → result_received`, skipping `acked`. The `ToolCallCard` renders correctly. No crash, no data loss.

**Server-side log**: The server records a `verdict: "violation"` entry even though the client did send the ACK before its own deadline. This is a **protocol gap** — the client cannot avoid this outcome without the server exposing the timeout deadline (e.g., a `TOOL_CALL` message that includes a `deadline_ts` field). Until that is added to the protocol, occasional violations in the `/log` output near the 5-second boundary are expected and unfixable from the client side alone.

**Mitigation implemented**: The `TOOL_ACK` is sent via `setTimeout(fn, Math.min(200, TOOL_ACK_TIMEOUT_MS))` — far below the 5-second server deadline, minimising the window during which the race can occur.
