'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/store/useAgentStore';

const PING_WATCHDOG_MS = 15_000; // warn after 15 s of silence

/**
 * usePing — informational PING watchdog.
 *
 * Starts a 15-second timer when the WebSocket is connected.  If no PING
 * arrives within that window, a console warning is emitted (the server
 * controls disconnection — we must NOT close it ourselves).
 *
 * The timer resets every time a PING event appears in the timeline, which
 * happens in `useWebSocket.ts` after every server PING is processed.
 *
 * Usage: call this hook once alongside `useWebSocket` in `AppShell`.
 */
export function usePing(): void {
  const timelineEvents = useAgentStore((s) => s.timelineEvents);
  const connectionState = useAgentStore((s) => s.connectionState);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function clearWatchdog() {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }

  function startWatchdog() {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      console.warn(
        '[usePing] No PING received from server in the last',
        PING_WATCHDOG_MS / 1000,
        'seconds. The server may drop the connection soon.',
      );
    }, PING_WATCHDOG_MS);
  }

  // ── Start / stop watchdog based on connection state ───────────────────────

  useEffect(() => {
    if (
      connectionState === 'connected' ||
      connectionState === 'streaming' ||
      connectionState === 'tool_call_pending' ||
      connectionState === 'resuming'
    ) {
      startWatchdog();
    } else {
      clearWatchdog();
    }

    return () => {
      clearWatchdog();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  // ── Reset watchdog on every new PING event ────────────────────────────────

  useEffect(() => {
    const lastEvent = timelineEvents[timelineEvents.length - 1];
    if (lastEvent?.eventType === 'ping') {
      startWatchdog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineEvents]);
}
