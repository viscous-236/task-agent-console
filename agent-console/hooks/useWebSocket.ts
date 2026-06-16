'use client';

import { useEffect, useRef, useCallback } from 'react';

import { parseServerMessage, serializeClientMessage } from '@/lib/wsProtocol';
import { SeqBuffer } from '@/lib/sequenceBuffer';
import { useAgentStore } from '@/store/useAgentStore';
import {
  WS_URL,
  TOOL_ACK_TIMEOUT_MS,
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MAX_MS,
} from '@/lib/constants';

import type {
  ClientMessage,
  ConnectionState,
  ServerMessage,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
  ContextSnapshotMessage,
  PingMessage,
  StreamEndMessage,
  ErrorMessage,
  ToolCallEvent,
  ToolResultEvent,
  ContextSnapshotEvent,
  PingEvent,
  PongEvent,
  StreamEndEvent,
  ErrorEvent,
  ReconnectEvent,
  ResumeEvent,
} from '@/lib/types';

// ─── Hook return type ──────────────────────────────────────────────────────────

export interface UseWebSocketReturn {
  send: (msg: ClientMessage) => void;
  disconnect: () => void;
  connectionState: ConnectionState;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket(): UseWebSocketReturn {
  const store = useAgentStore();

  // Refs — none of these trigger re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const seqBufferRef = useRef<SeqBuffer>(new SeqBuffer());
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pongWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);
  // Keep a live ref to lastProcessedSeq so the closure inside onclose reads
  // the current value without stale captures.
  const lastProcessedSeqRef = useRef<number>(-1);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clearBackoffTimer() {
    if (backoffTimerRef.current !== null) {
      clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = null;
    }
  }

  function clearPongWatchdog() {
    if (pongWatchdogRef.current !== null) {
      clearTimeout(pongWatchdogRef.current);
      pongWatchdogRef.current = null;
    }
  }

  function safeSendRaw(raw: string): void {
    const ws = wsRef.current;
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }

  // ── processMessage ─────────────────────────────────────────────────────────

  function processMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'TOKEN': {
        const m = msg as TokenMessage;
        // If no AgentMessage exists for this stream yet, initialise it first
        const hasStream = store.messages.some(
          (cm) => cm.role === 'assistant' && cm.id === m.stream_id,
        );
        if (!hasStream) {
          store.initAgentStream(m.stream_id);
        }
        store.setConnectionState('streaming');
        store.appendToken(m.stream_id, m.text);
        store.addTokenToTimeline(m);
        break;
      }

      case 'TOOL_CALL': {
        const m = msg as ToolCallMessage;
        store.setConnectionState('tool_call_pending');
        store.addToolCall(m);

        const toolCallEvent: ToolCallEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'tool_call',
          call_id: m.call_id,
          tool_name: m.tool_name,
          args: m.args,
          stream_id: m.stream_id,
        };
        store.addTimelineEvent(toolCallEvent);

        // Schedule TOOL_ACK — must be sent within TOOL_ACK_TIMEOUT_MS (2000ms).
        // Per spec: use Math.min(200, TOOL_ACK_TIMEOUT_MS) as the actual delay.
        const ackDelay = Math.min(200, TOOL_ACK_TIMEOUT_MS);
        setTimeout(() => {
          const ackMsg: ClientMessage = { type: 'TOOL_ACK', call_id: m.call_id };
          safeSendRaw(serializeClientMessage(ackMsg));
          store.ackToolCall(m.call_id);
        }, ackDelay);
        break;
      }

      case 'TOOL_RESULT': {
        const m = msg as ToolResultMessage;
        store.setToolResult(m);

        const toolResultEvent: ToolResultEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'tool_result',
          call_id: m.call_id,
          result: m.result,
          stream_id: m.stream_id,
        };
        store.addTimelineEvent(toolResultEvent);
        store.setConnectionState('streaming');
        break;
      }

      case 'CONTEXT_SNAPSHOT': {
        const m = msg as ContextSnapshotMessage;
        store.addContextSnapshot(m);

        // Determine snapshotIndex: it will be the current length of the array
        // after insertion. The store auto-sets contextViewIndex, so we read back.
        const snapshotIndex =
          (store.contextSnapshots[m.context_id]?.length ?? 1) - 1;

        const snapshotEvent: ContextSnapshotEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'context_snapshot',
          context_id: m.context_id,
          snapshotIndex,
        };
        store.addTimelineEvent(snapshotEvent);
        break;
      }

      case 'PING': {
        const m = msg as PingMessage;

        const pingEvent: PingEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'ping',
          challenge: m.challenge,
        };
        store.addTimelineEvent(pingEvent);

        // Respond immediately — empty challenge is valid, echo it back as-is
        const pongMsg: ClientMessage = { type: 'PONG', echo: m.challenge };
        safeSendRaw(serializeClientMessage(pongMsg));

        const pongEvent: PongEvent = {
          id: crypto.randomUUID(),
          seq: 0, // client-generated, no server seq
          timestamp: Date.now(),
          eventType: 'pong',
          echo: m.challenge,
        };
        store.addTimelineEvent(pongEvent);

        // Reset the PONG watchdog timer
        clearPongWatchdog();
        break;
      }

      case 'STREAM_END': {
        const m = msg as StreamEndMessage;
        store.completeStream(m.stream_id);
        store.flushTokenBatch();

        const streamEndEvent: StreamEndEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'stream_end',
          stream_id: m.stream_id,
        };
        store.addTimelineEvent(streamEndEvent);
        store.setConnectionState('connected');
        break;
      }

      case 'ERROR': {
        const m = msg as ErrorMessage;
        const errorEvent: ErrorEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'error',
          code: m.code,
          message: m.message,
        };
        store.addTimelineEvent(errorEvent);
        console.error('[WS] Server ERROR:', m.code, m.message);
        break;
      }

      default:
        break;
    }
  }

  // ── Disconnect & reconnect helpers (defined before connect) ────────────────

  function scheduleReconnect(attempt: number, lastSeq: number): void {
    const delay = Math.min(
      RECONNECT_BACKOFF_BASE_MS * Math.pow(2, attempt),
      RECONNECT_BACKOFF_MAX_MS,
    );
    backoffTimerRef.current = setTimeout(() => {
      connect(lastSeq);
    }, delay);
  }

  // ── connect ────────────────────────────────────────────────────────────────

  function connect(lastSeq: number): void {
    clearBackoffTimer();
    store.setConnectionState('connecting');

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      store.setConnectionState('connected');

      if (lastSeq >= 0) {
        // Reconnect scenario — send RESUME as the very first message
        store.setConnectionState('resuming');
        const resumeMsg: ClientMessage = { type: 'RESUME', last_seq: lastSeq };
        ws.send(serializeClientMessage(resumeMsg));

        const resumeEvent: ResumeEvent = {
          id: crypto.randomUUID(),
          seq: 0,
          timestamp: Date.now(),
          eventType: 'resume',
          last_seq: lastSeq,
        };
        store.addTimelineEvent(resumeEvent);
      }

      store.resetReconnectAttempt();
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      const parsed = parseServerMessage(event.data);
      if (parsed === null) {
        console.warn('[WS] Unparseable message received:', event.data);
        return;
      }

      seqBufferRef.current.insert(parsed);
      const ordered = seqBufferRef.current.drain();

      for (const msg of ordered) {
        processMessage(msg);
      }

      const newLastSeq = seqBufferRef.current.getLastProcessed();
      store.setLastProcessedSeq(newLastSeq);
      lastProcessedSeqRef.current = newLastSeq;
    };

    const handleClose = (ev: CloseEvent | Event) => {
      console.warn('[WS] Connection closed/errored:', ev);
      store.flushTokenBatch();

      if (!intentionalCloseRef.current) {
        store.setConnectionState('reconnecting');
        store.incrementReconnectAttempt();

        const attempt = store.reconnectAttempt; // read after increment
        const reconnectEvent: ReconnectEvent = {
          id: crypto.randomUUID(),
          seq: 0,
          timestamp: Date.now(),
          eventType: 'reconnect',
          attempt,
        };
        store.addTimelineEvent(reconnectEvent);

        scheduleReconnect(attempt, lastProcessedSeqRef.current);
      } else {
        store.setConnectionState('closed');
      }
    };

    ws.onclose = handleClose;
    ws.onerror = handleClose;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  const send = useCallback((msg: ClientMessage): void => {
    safeSendRaw(serializeClientMessage(msg));
  }, []);

  const disconnect = useCallback((): void => {
    intentionalCloseRef.current = true;
    clearBackoffTimer();
    clearPongWatchdog();
    wsRef.current?.close();
  }, []);

  // ── Effect — connect on mount, cleanup on unmount ──────────────────────────

  useEffect(() => {
    intentionalCloseRef.current = false;
    // Fresh session: lastSeq = -1 means no RESUME is sent on initial connect
    connect(-1);

    return () => {
      intentionalCloseRef.current = true;
      clearBackoffTimer();
      clearPongWatchdog();
      const ws = wsRef.current;
      if (ws !== null) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    send,
    disconnect,
    connectionState: store.connectionState,
  };
}
