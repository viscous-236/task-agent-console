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
