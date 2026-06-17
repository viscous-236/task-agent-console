'use client';

import React from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { ConnectionState } from '@/lib/types';

interface StateConfig {
  label: string;
  dot: string;
  text: string;
  ring: string;
}

const STATE_CONFIG: Record<ConnectionState, StateConfig> = {
  idle:              { label: 'Idle',         dot: 'bg-gray-500',                      text: 'text-gray-400',   ring: 'border-gray-500/30'   },
  connecting:        { label: 'Connecting',   dot: 'bg-yellow-400 animate-pulse',       text: 'text-yellow-300', ring: 'border-yellow-500/30' },
  connected:         { label: 'Connected',    dot: 'bg-green-400',                      text: 'text-green-300',  ring: 'border-green-500/30'  },
  streaming:         { label: 'Streaming',    dot: 'bg-green-400 animate-pulse',         text: 'text-green-300',  ring: 'border-green-500/30'  },
  tool_call_pending: { label: 'Tool Running', dot: 'bg-yellow-400 animate-pulse',       text: 'text-yellow-300', ring: 'border-yellow-500/30' },
  reconnecting:      { label: 'Reconnecting', dot: 'bg-red-400 animate-pulse',          text: 'text-red-300',    ring: 'border-red-500/30'    },
  resuming:          { label: 'Resuming',     dot: 'bg-yellow-400 animate-pulse',       text: 'text-yellow-300', ring: 'border-yellow-500/30' },
  closed:            { label: 'Closed',       dot: 'bg-gray-600',                       text: 'text-gray-500',   ring: 'border-gray-600/30'   },
};

export function ConnectionStatus() {
  const connectionState = useAgentStore((s) => s.connectionState);
  const cfg = STATE_CONFIG[connectionState];

  return (
    <div
      id="connection-status-badge"
      aria-label={`Connection status: ${cfg.label}`}
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded-full
        bg-white/5 border ${cfg.ring}
        text-xs font-mono transition-all duration-300
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} aria-hidden="true" />
      <span className={cfg.text}>{cfg.label}</span>
    </div>
  );
}
