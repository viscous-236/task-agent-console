'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { RECONNECT_INDICATOR_DELAY_MS } from '@/lib/constants';

export function ReconnectBanner() {
  const connectionState = useAgentStore((s) => s.connectionState);
  const reconnectAttempt = useAgentStore((s) => s.reconnectAttempt);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (connectionState === 'reconnecting') {
      // Only show banner after RECONNECT_INDICATOR_DELAY_MS (500ms) —
      // avoids flickering on transient drops
      timerRef.current = setTimeout(() => {
        setVisible(true);
      }, RECONNECT_INDICATOR_DELAY_MS);
    } else {
      // Connected again (or other state) — clear timer and start fade-out
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setVisible(false);
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [connectionState]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="
        fixed top-3 left-1/2 -translate-x-1/2 z-50
        flex items-center gap-2.5 px-4 py-2 rounded-xl
        bg-orange-950/90 border border-orange-500/30
        shadow-lg shadow-orange-900/30 backdrop-blur-sm
        text-sm text-orange-200
        animate-in fade-in slide-in-from-top-2 duration-300
      "
    >
      {/* Spinner */}
      <svg
        className="w-4 h-4 animate-spin text-orange-400 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12" cy="12" r="10"
          stroke="currentColor" strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="font-medium">
        Reconnecting…
      </span>
      <span className="text-orange-300/70 text-xs font-mono">
        (attempt {reconnectAttempt})
      </span>
    </div>
  );
}
