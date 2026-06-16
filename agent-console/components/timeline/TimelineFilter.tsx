'use client';

import React from 'react';
import type { TimelineEventType } from '@/lib/types';

// All event types the server can produce
const ALL_TYPES: TimelineEventType[] = [
  'token_batch',
  'tool_call',
  'tool_result',
  'context_snapshot',
  'ping',
  'pong',
  'stream_end',
  'error',
  'reconnect',
  'resume',
];

const TYPE_LABELS: Record<TimelineEventType, string> = {
  token_batch:      'Tokens',
  tool_call:        'Tool Call',
  tool_result:      'Tool Result',
  context_snapshot: 'Context',
  ping:             'Ping',
  pong:             'Pong',
  stream_end:       'Stream End',
  error:            'Error',
  reconnect:        'Reconnect',
  resume:           'Resume',
};

export interface TimelineFilterState {
  enabledTypes: Set<TimelineEventType>;
  searchText: string;
}

export function defaultFilterState(): TimelineFilterState {
  return {
    enabledTypes: new Set(ALL_TYPES),
    searchText: '',
  };
}

interface TimelineFilterProps {
  filter: TimelineFilterState;
  onChange: (next: TimelineFilterState) => void;
}

export function TimelineFilter({ filter, onChange }: TimelineFilterProps) {
  function toggleType(type: TimelineEventType) {
    const next = new Set(filter.enabledTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filter, enabledTypes: next });
  }

  function toggleAll() {
    const allEnabled = filter.enabledTypes.size === ALL_TYPES.length;
    onChange({
      ...filter,
      enabledTypes: allEnabled ? new Set() : new Set(ALL_TYPES),
    });
  }

  const allEnabled = filter.enabledTypes.size === ALL_TYPES.length;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-b border-white/8">
      {/* Search box */}
      <input
        id="timeline-search"
        type="text"
        placeholder="Search events…"
        value={filter.searchText}
        onChange={(e) => onChange({ ...filter, searchText: e.target.value })}
        className="
          w-full bg-white/5 border border-white/10 rounded-md
          px-2.5 py-1.5 text-xs text-white placeholder-white/30
          focus:outline-none focus:border-indigo-500/50 transition-colors
          font-mono
        "
      />

      {/* Checkbox group */}
      <div className="flex flex-wrap gap-1.5">
        {/* All toggle */}
        <button
          onClick={toggleAll}
          className={`
            text-[10px] px-2 py-0.5 rounded border font-mono font-bold transition-colors
            ${allEnabled
              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
              : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'}
          `}
        >
          ALL
        </button>

        {ALL_TYPES.map((type) => {
          const active = filter.enabledTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`
                text-[10px] px-2 py-0.5 rounded border font-mono transition-colors
                ${active
                  ? 'bg-white/10 text-white/80 border-white/20'
                  : 'bg-transparent text-white/25 border-white/8 hover:border-white/15'}
              `}
            >
              {TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
