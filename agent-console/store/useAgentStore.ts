import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type {
  AgentStoreState,
  ConnectionState,
  AgentMessage,
  UserMessage,
  ToolCallRecord,
  TimelineEvent,
  TokenBatchEvent,
  ContextSnapshotRecord,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
  ContextSnapshotMessage,
} from '@/lib/types';

// ─── Initial state ─────────────────────────────────────────────────────────────

const INITIAL_STATE: AgentStoreState = {
  connectionState: 'idle',
  reconnectAttempt: 0,
  lastProcessedSeq: -1,

  messages: [],
  activeStreamId: null,

  timelineEvents: [],
  activeTokenBatch: null,

  contextSnapshots: {},
  contextViewIndex: {},

  highlightedCallId: null,
  highlightedTimelineId: null,
};

// ─── Store actions interface ───────────────────────────────────────────────────

interface AgentStoreActions {
  // Connection
  setConnectionState(state: ConnectionState): void;
  setLastProcessedSeq(seq: number): void;
  incrementReconnectAttempt(): void;
  resetReconnectAttempt(): void;

  // Chat
  addUserMessage(content: string): void;
  initAgentStream(stream_id: string): void;
  appendToken(stream_id: string, text: string): void;
  addToolCall(msg: ToolCallMessage): void;
  ackToolCall(call_id: string): void;
  setToolResult(msg: ToolResultMessage): void;
  completeStream(stream_id: string): void;

  // Timeline
  flushTokenBatch(): void;
  addTokenToTimeline(msg: TokenMessage): void;
  addTimelineEvent(event: TimelineEvent): void;

  // Context
  addContextSnapshot(msg: ContextSnapshotMessage): void;
  setContextViewIndex(context_id: string, index: number): void;

  // Highlight / selection
  setHighlightedCallId(call_id: string | null): void;
  setHighlightedTimelineId(id: string | null): void;

  // Reset
  resetSession(): void;
}

export type AgentStore = AgentStoreState & AgentStoreActions;

// ─── Store implementation ──────────────────────────────────────────────────────

export const useAgentStore = create<AgentStore>()(
  immer((set) => ({
    ...INITIAL_STATE,

    // ── Connection ───────────────────────────────────────────────────────────

    setConnectionState(state: ConnectionState) {
      set((draft) => {
        draft.connectionState = state;
      });
    },

    setLastProcessedSeq(seq: number) {
      set((draft) => {
        if (seq > draft.lastProcessedSeq) {
          draft.lastProcessedSeq = seq;
        }
      });
    },

    incrementReconnectAttempt() {
      set((draft) => {
        draft.reconnectAttempt += 1;
      });
    },

    resetReconnectAttempt() {
      set((draft) => {
        draft.reconnectAttempt = 0;
      });
    },

    // ── Chat ─────────────────────────────────────────────────────────────────

    addUserMessage(content: string) {
      set((draft) => {
        const msg: UserMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content,
        };
        draft.messages.push(msg);
      });
    },

    initAgentStream(stream_id: string) {
      set((draft) => {
        // 8.1 chaos hardening: on RESUME replay, the server may re-send TOKEN
        // events for a stream_id that already has an AgentMessage in the store.
        // Guard against creating a duplicate — simply reactivate the existing one.
        const existing = draft.messages.find(
          (m): m is AgentMessage => m.role === 'assistant' && m.id === stream_id,
        );
        if (existing !== undefined) {
          draft.activeStreamId = stream_id;
          return;
        }

        const msg: AgentMessage = {
          id: stream_id,
          role: 'assistant',
          segments: [],
          toolCalls: {},
          isComplete: false,
        };
        draft.messages.push(msg);
        draft.activeStreamId = stream_id;
      });
    },

    appendToken(stream_id: string, text: string) {
      set((draft) => {
        const msg = draft.messages.find(
          (m): m is AgentMessage => m.role === 'assistant' && m.id === stream_id,
        );
        if (!msg) return; // graceful no-op if stream not found

        const lastSegment = msg.segments[msg.segments.length - 1];
        if (lastSegment !== undefined && lastSegment.kind === 'text') {
          // Extend the existing text segment in-place (immer makes this safe)
          lastSegment.content += text;
        } else {
          msg.segments.push({ kind: 'text', content: text });
        }
      });
    },

    addToolCall(msg: ToolCallMessage) {
      set((draft) => {
        const agentMsg = draft.messages.find(
          (m): m is AgentMessage =>
            m.role === 'assistant' && m.id === msg.stream_id,
        );
        if (!agentMsg) return;

        const record: ToolCallRecord = {
          call_id: msg.call_id,
          tool_name: msg.tool_name,
          args: msg.args,
          status: 'pending',
          result: null,
          seq: msg.seq,
        };
        agentMsg.toolCalls[msg.call_id] = record;
        agentMsg.segments.push({ kind: 'tool_call', call_id: msg.call_id });
      });
    },

    ackToolCall(call_id: string) {
      set((draft) => {
        for (const m of draft.messages) {
          if (m.role !== 'assistant') continue;
          const record = m.toolCalls[call_id];
          if (record !== undefined) {
            record.status = 'acked';
            break;
          }
        }
      });
    },

    setToolResult(msg: ToolResultMessage) {
      set((draft) => {
        const agentMsg = draft.messages.find(
          (m): m is AgentMessage =>
            m.role === 'assistant' && m.id === msg.stream_id,
        );
        if (!agentMsg) return;
        const record = agentMsg.toolCalls[msg.call_id];
        if (record !== undefined) {
          record.result = msg.result;
          record.status = 'result_received';
        }
      });
    },

    completeStream(stream_id: string) {
      set((draft) => {
        const agentMsg = draft.messages.find(
          (m): m is AgentMessage => m.role === 'assistant' && m.id === stream_id,
        );
        if (agentMsg) {
          agentMsg.isComplete = true;
        }
        draft.activeStreamId = null;
      });
    },

    // ── Timeline ─────────────────────────────────────────────────────────────

    flushTokenBatch() {
      set((draft) => {
        const batch = draft.activeTokenBatch;
        if (batch === null) return;

        const event: TokenBatchEvent = {
          id: crypto.randomUUID(),
          seq: 0, // token batches are synthetic — no single seq
          timestamp: Date.now(),
          eventType: 'token_batch',
          stream_id: batch.stream_id,
          tokenCount: batch.tokenCount,
          durationMs: Date.now() - batch.startTime,
          fullText: batch.text,
        };
        draft.timelineEvents.push(event);
        draft.activeTokenBatch = null;
      });
    },

    addTokenToTimeline(msg: TokenMessage) {
      set((draft) => {
        const batch = draft.activeTokenBatch;

        if (batch === null || batch.stream_id !== msg.stream_id) {
          // Flush previous batch first (if any)
          if (batch !== null) {
            const flushEvent: TokenBatchEvent = {
              id: crypto.randomUUID(),
              seq: 0,
              timestamp: Date.now(),
              eventType: 'token_batch',
              stream_id: batch.stream_id,
              tokenCount: batch.tokenCount,
              durationMs: Date.now() - batch.startTime,
              fullText: batch.text,
            };
            draft.timelineEvents.push(flushEvent);
          }
          // Start a new batch
          draft.activeTokenBatch = {
            stream_id: msg.stream_id,
            startTime: Date.now(),
            tokenCount: 1,
            text: msg.text,
          };
        } else {
          // Extend the current batch
          batch.tokenCount += 1;
          batch.text += msg.text;
        }
      });
    },

    addTimelineEvent(event: TimelineEvent) {
      set((draft) => {
        // Flush any open token batch before pushing a non-token event
        const batch = draft.activeTokenBatch;
        if (batch !== null) {
          const flushEvent: TokenBatchEvent = {
            id: crypto.randomUUID(),
            seq: 0,
            timestamp: Date.now(),
            eventType: 'token_batch',
            stream_id: batch.stream_id,
            tokenCount: batch.tokenCount,
            durationMs: Date.now() - batch.startTime,
            fullText: batch.text,
          };
          draft.timelineEvents.push(flushEvent);
          draft.activeTokenBatch = null;
        }
        draft.timelineEvents.push(event);
      });
    },

    // ── Context ──────────────────────────────────────────────────────────────

    addContextSnapshot(msg: ContextSnapshotMessage) {
      set((draft) => {
        if (draft.contextSnapshots[msg.context_id] === undefined) {
          draft.contextSnapshots[msg.context_id] = [];
        }
        const arr = draft.contextSnapshots[msg.context_id];
        // arr is guaranteed to exist after the check above; immer draft arrays
        // won't be undefined here, but the compiler requires the check.
        if (arr === undefined) return;

        const snapshotIndex = arr.length; // 0-based position this will occupy
        const record: ContextSnapshotRecord = {
          context_id: msg.context_id,
          seq: msg.seq,
          timestamp: Date.now(),
          data: msg.data,
          snapshotIndex,
        };
        arr.push(record);
        // Auto-advance the scrubber to the latest snapshot
        draft.contextViewIndex[msg.context_id] = snapshotIndex;
      });
    },

    setContextViewIndex(context_id: string, index: number) {
      set((draft) => {
        const arr = draft.contextSnapshots[context_id];
        if (arr === undefined || arr.length === 0) return;
        // Bounds check: clamp to [0, length - 1]
        const clamped = Math.max(0, Math.min(index, arr.length - 1));
        draft.contextViewIndex[context_id] = clamped;
      });
    },

    // ── Highlight / selection ─────────────────────────────────────────────────

    setHighlightedCallId(call_id: string | null) {
      set((draft) => {
        draft.highlightedCallId = call_id;
      });
    },

    setHighlightedTimelineId(id: string | null) {
      set((draft) => {
        draft.highlightedTimelineId = id;
      });
    },

    // ── Reset ─────────────────────────────────────────────────────────────────

    resetSession() {
      set(() => ({ ...INITIAL_STATE }));
    },
  })),
);
