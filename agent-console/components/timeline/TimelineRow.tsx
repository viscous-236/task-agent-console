'use client';

import React, { memo, useCallback } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type {
  TimelineEvent,
  ToolCallEvent,
  ToolResultEvent,
  PingEvent,
  PongEvent,
  StreamEndEvent,
  ErrorEvent,
  ReconnectEvent,
  ResumeEvent,
  ContextSnapshotEvent,
} from '@/lib/types';

// ─── Relative timestamp ───────────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 1000) return `${diffMs}ms ago`;
  if (diffMs < 60_000) return `${(diffMs / 1000).toFixed(1)}s ago`;
  return `${Math.floor(diffMs / 60_000)}m ago`;
}

// ─── Event type badge config ──────────────────────────────────────────────────

interface BadgeConfig {
  label: string;
  classes: string;
}

const BADGE: Record<string, BadgeConfig> = {
  token_batch:      { label: 'TOKENS',   classes: 'bg-violet-500/20 text-violet-300 border border-violet-500/30' },
  tool_call:        { label: 'TOOL_CALL', classes: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  tool_result:      { label: 'TOOL_RES', classes: 'bg-green-500/20  text-green-300  border border-green-500/30'  },
  context_snapshot: { label: 'CONTEXT',  classes: 'bg-blue-500/20   text-blue-300   border border-blue-500/30'   },
  ping:             { label: 'PING',     classes: 'bg-sky-500/20    text-sky-300    border border-sky-500/30'    },
  pong:             { label: 'PONG',     classes: 'bg-cyan-500/20   text-cyan-300   border border-cyan-500/30'   },
  stream_end:       { label: 'END',      classes: 'bg-gray-500/20   text-gray-300   border border-gray-500/30'   },
  error:            { label: 'ERROR',    classes: 'bg-red-500/20    text-red-300    border border-red-500/30'    },
  reconnect:        { label: 'RECONNECT',classes: 'bg-orange-500/20 text-orange-300 border border-orange-500/30' },
  resume:           { label: 'RESUME',   classes: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' },
};

function EventBadge({ type }: { type: string }) {
  const cfg = BADGE[type] ?? { label: type.toUpperCase(), classes: 'bg-white/10 text-white/50 border border-white/10' };
  return (
    <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ─── Summary text builder ─────────────────────────────────────────────────────

function buildSummary(event: TimelineEvent): string {
  switch (event.eventType) {
    case 'token_batch':      return `Streamed ${event.tokenCount} tokens`;
    case 'tool_call':        return `${(event as ToolCallEvent).tool_name} (${(event as ToolCallEvent).call_id.slice(-6)})`;
    case 'tool_result':      return `Result for ${(event as ToolResultEvent).call_id.slice(-6)}`;
    case 'context_snapshot': return `ctx:${(event as ContextSnapshotEvent).context_id} snap#${(event as ContextSnapshotEvent).snapshotIndex}`;
    case 'ping':             return `challenge: ${(event as PingEvent).challenge || '(empty)'}`;
    case 'pong':             return `echo: ${(event as PongEvent).echo || '(empty)'}`;
    case 'stream_end':       return `stream ${(event as StreamEndEvent).stream_id.slice(-6)} done`;
    case 'error':            return `${(event as ErrorEvent).code}: ${(event as ErrorEvent).message}`;
    case 'reconnect':        return `Attempt #${(event as ReconnectEvent).attempt}`;
    case 'resume':           return `last_seq=${(event as ResumeEvent).last_seq}`;
    default:                 return '';
  }
}

// ─── call_id extractor (for tool events) ──────────────────────────────────────

function getCallId(event: TimelineEvent): string | null {
  if (event.eventType === 'tool_call') return (event as ToolCallEvent).call_id;
  if (event.eventType === 'tool_result') return (event as ToolResultEvent).call_id;
  return null;
}

// ─── TimelineRow ──────────────────────────────────────────────────────────────

interface TimelineRowProps {
  event: TimelineEvent;
}

export const TimelineRow = memo(function TimelineRow({ event }: TimelineRowProps) {
  const isHighlighted = useAgentStore((s) => s.highlightedTimelineId === event.id);
  const setHighlightedTimelineId = useAgentStore((s) => s.setHighlightedTimelineId);
  const setHighlightedCallId = useAgentStore((s) => s.setHighlightedCallId);

  const callId = getCallId(event);
  const isLinkedEvent = callId !== null; // tool_call or tool_result
  const isToolResult = event.eventType === 'tool_result';

  const handleClick = useCallback(() => {
    setHighlightedTimelineId(event.id);
    if (callId !== null) {
      setHighlightedCallId(callId);
      // Scroll the matching ToolCallCard into view
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-call-id="${callId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [event.id, callId, setHighlightedTimelineId, setHighlightedCallId]);

  return (
    <div
      data-timeline-id={event.id}
      onClick={handleClick}
      className={`
        group flex items-start gap-2 px-3 py-1.5 cursor-pointer
        rounded-md transition-all duration-150 text-xs
        ${isHighlighted
          ? 'bg-indigo-500/15 border border-indigo-500/30'
          : 'hover:bg-white/4 border border-transparent'
        }
        ${isLinkedEvent ? 'ml-3' : ''}
      `}
    >
      {/* Left border line for linked tool_call / tool_result pairs */}
      {isLinkedEvent && (
        <div
          className={`
            shrink-0 w-0.5 self-stretch rounded-full mt-0.5
            ${isToolResult ? 'bg-green-500/40' : 'bg-yellow-500/40'}
          `}
        />
      )}

      {/* Badge */}
      <EventBadge type={event.eventType} />

      {/* Summary */}
      <span className="flex-1 text-white/70 truncate font-mono leading-4 pt-0.5">
        {buildSummary(event)}
      </span>

      {/* Timestamp */}
      <span className="shrink-0 text-white/25 tabular-nums pt-0.5">
        {relativeTime(event.timestamp)}
      </span>
    </div>
  );
});
TimelineRow.displayName = 'TimelineRow';
