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
  connectionState: string;
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
  // Set to true immediately after sending RESUME so the first incoming message
  // can be inspected for a server-seq-reset condition.
  const isFirstMsgAfterResumeRef = useRef<boolean>(false);

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
        // If no AgentMessage exists for this stream yet, initialise it first.
        // Use getState() to read live state (store ref in closure is stale).
        const hasStream = useAgentStore.getState().messages.some(
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

        // Determine snapshotIndex: read live state after insertion.
        const snapshotIndex =
          (useAgentStore.getState().contextSnapshots[m.context_id]?.length ?? 1) - 1;

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

        // NOTE: the PONG is sent immediately in the onmessage handler (before
        // SeqBuffer processing) to guarantee the 3-second deadline is always met.
        // processMessage is only responsible for the timeline events here.
        const pingEvent: PingEvent = {
          id: crypto.randomUUID(),
          seq: m.seq,
          timestamp: Date.now(),
          eventType: 'ping',
          challenge: m.challenge,
        };
        store.addTimelineEvent(pingEvent);

        const pongEvent: PongEvent = {
          id: crypto.randomUUID(),
          seq: 0, // client-generated, no server seq
          timestamp: Date.now(),
          eventType: 'pong',
          echo: m.challenge,
        };
        store.addTimelineEvent(pongEvent);

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

        // Reset reconnect attempt only on full stream completion so exponential
        // backoff accumulates correctly through rapid chaos drops within a turn.
        store.resetReconnectAttempt();
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

  // ── Disconnect & reconnect helpers ────────────────────────────────────────

  function scheduleReconnect(attempt: number, lastSeq: number): void {
    const delay = Math.min(
      RECONNECT_BACKOFF_BASE_MS * Math.pow(2, attempt - 1),
      RECONNECT_BACKOFF_MAX_MS,
    );
    console.log(`[WS] Reconnect attempt ${attempt} in ${delay}ms (last_seq=${lastSeq})`);
    backoffTimerRef.current = setTimeout(() => {
      connect(lastSeq);
    }, delay);
  }

  // ── connect ────────────────────────────────────────────────────────────────

  function connect(lastSeq: number): void {
    clearBackoffTimer();

    // ── Clean up the previous WebSocket before opening a new one ─────────
    // Null handlers BEFORE calling close() so the server-initiated
    // close (code 1000, reason 'replaced') that the server sends when a new
    // connection supersedes an old one does NOT trigger handleClose on the
    // old socket and kick off a spurious reconnect cycle.
    const oldWs = wsRef.current;
    if (oldWs !== null) {
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      if (
        oldWs.readyState === WebSocket.OPEN ||
        oldWs.readyState === WebSocket.CONNECTING
      ) {
        oldWs.close();
      }
    }

    store.setConnectionState('connecting');

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Stream-level messages (TOKEN etc.) will update state further.
      if (lastSeq >= 0) {
        // Reconnect scenario — send RESUME as the very first message.
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

        // Arm the first-message check so we can detect server seq reset
        // and transition out of 'resuming' state.
        isFirstMsgAfterResumeRef.current = true;
      } else {
        // Fresh connection
        store.setConnectionState('connected');
      }
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      const parsed = parseServerMessage(event.data);
      if (parsed === null) {
        console.warn('[WS] Unparseable message received:', event.data);
        return;
      }

      // ── PING bypass ───────────────────────────────────────────────────────
      // Send PONG immediately, BEFORE the SeqBuffer, to guarantee the 3-second
      // deadline is always met.  This is critical for two failure modes:
      //
      //   (a) Seq gap in the buffer: the PING is held waiting for an earlier
      //       message; without the bypass it would time out in the buffer.
      //
      //   (b) Server seq reset (e.g. container restart with no history): the
      //       server emits from seq=1 while our SeqBuffer.lastProcessed is 21.
      //       Every message including PINGs is silently dropped, so no PONG
      //       is ever sent → server terminates after 3 missed PONGs.
      //
      // processMessage (called after SeqBuffer drain) still runs for PINGs
      // that pass through the buffer — it logs the timeline events only
      // (no second PONG is sent there).
      if (parsed.type === 'PING') {
        const ping = parsed as PingMessage;
        safeSendRaw(serializeClientMessage({ type: 'PONG', echo: ping.challenge }));
      }

      // ── Detect server seq reset after RESUME ──────────────────────────────
      // When the server is restarted fresh (docker stop/start, no history),
      // it resets its seq counter to 0 and emits from seq=1.  If our
      // SeqBuffer.lastProcessed is still the pre-restart value (e.g. 21),
      // ALL incoming messages are silently dropped as "duplicates".
      //
      // Detection: the FIRST message received after sending RESUME has
      // seq ≤ lastProcessed  →  the server reset its counter.
      // Action: reset the SeqBuffer to 0 so all new messages are accepted.
      //
      // This flag is only checked once per RESUME (cleared on first message),
      // which avoids false positives from chaos-mode duplicate replays during
      // normal reconnections where the server does have history (in that case
      // the first replayed event always has seq > lastProcessed).
      if (isFirstMsgAfterResumeRef.current) {
        isFirstMsgAfterResumeRef.current = false;
        
        // Transition out of 'resuming' state per the strict state machine spec.
        if (useAgentStore.getState().connectionState === 'resuming') {
          store.setConnectionState('connected');
        }

        const currentLastProcessed = seqBufferRef.current.getLastProcessed();
        if (parsed.seq > 0 && parsed.seq <= currentLastProcessed) {
          console.log(
            `[WS] Server seq reset detected (got seq=${parsed.seq}, lastProcessed=${currentLastProcessed}). Resetting SeqBuffer to 0.`,
          );
          seqBufferRef.current.reset(0);
          lastProcessedSeqRef.current = 0;
          store.setLastProcessedSeq(-1); // allow the store to track fresh from 0
        }
      }

      seqBufferRef.current.insert(parsed);
      const ordered = seqBufferRef.current.drain();

      for (const msg of ordered) {
        processMessage(msg);
      }

      const newLastSeq = seqBufferRef.current.getLastProcessed();
      lastProcessedSeqRef.current = newLastSeq;
      store.setLastProcessedSeq(newLastSeq);
    };

    const handleClose = (ev: CloseEvent | Event) => {
      // ── Identity guard ────────────────────────────────────────────────────
      // When the server closes the OLD socket with code 1000/reason 'replaced'
      // (because a new connection came in), this handleClose fires via the
      // closure even though we already nulled ws.onclose in connect() cleanup.
      // The server-initiated close frame was already in-flight on the network.
      // Guard: only act if this ws is still the ACTIVE socket.
      if (wsRef.current !== ws) {
        return;
      }

      // Null handlers immediately to prevent onerror + onclose double-fire.
      ws.onclose = null;
      ws.onerror = null;

      isFirstMsgAfterResumeRef.current = false; // clear stale flag on disconnect

      console.warn('[WS] Connection closed/errored:', ev);
      store.flushTokenBatch();

      if (!intentionalCloseRef.current) {
        store.setConnectionState('reconnecting');
        store.incrementReconnectAttempt();

        // Read live state after increment (store ref in closure is stale)
        const attempt = useAgentStore.getState().reconnectAttempt;
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
    if (msg.type === 'USER_MESSAGE') {
      // The server resets its seq counter to 0 on each USER_MESSAGE, so the
      // next turn starts at seq=1.  Reset BOTH the SeqBuffer AND the
      // lastProcessedSeqRef — if we only reset the buffer, a second message
      // after a drop would RESUME with the stale high seq from the first turn,
      // and the server (now at seq=1) would replay nothing.
      seqBufferRef.current.reset(0);
      lastProcessedSeqRef.current = 0;
      store.setLastProcessedSeq(-1); // allow store to track fresh from 0
      store.resetReconnectAttempt(); // new turn = fresh backoff counter
    }
    safeSendRaw(serializeClientMessage(msg));
  }, [store]);

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
        ws.onopen = null;
        ws.onmessage = null;
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
