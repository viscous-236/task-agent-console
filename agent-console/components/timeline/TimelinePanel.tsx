'use client';

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { TimelineEvent } from '@/lib/types';
import { TimelineRow } from './TimelineRow';
import { TokenBatchRow } from './TokenBatchRow';
import {
  TimelineFilter,
  defaultFilterState,
  type TimelineFilterState,
} from './TimelineFilter';

const SCROLL_THRESHOLD = 60; // px from bottom

// ─── Summary text for search matching ────────────────────────────────────────

function eventSummaryText(event: TimelineEvent): string {
  switch (event.eventType) {
    case 'token_batch':      return `tokens ${event.stream_id} ${event.fullText.slice(0, 80)}`;
    case 'tool_call':        return `tool_call ${event.tool_name} ${event.call_id}`;
    case 'tool_result':      return `tool_result ${event.call_id}`;
    case 'context_snapshot': return `context ${event.context_id}`;
    case 'ping':             return `ping ${event.challenge}`;
    case 'pong':             return `pong ${event.echo}`;
    case 'stream_end':       return `stream_end ${event.stream_id}`;
    case 'error':            return `error ${event.code} ${event.message}`;
    case 'reconnect':        return `reconnect ${event.attempt}`;
    case 'resume':           return `resume ${event.last_seq}`;
    default:                 return '';
  }
}

// ─── TimelinePanel ────────────────────────────────────────────────────────────

interface TimelinePanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function TimelinePanel({ collapsed, onToggle }: TimelinePanelProps) {
  const timelineEvents = useAgentStore((s) => s.timelineEvents);
  const highlightedTimelineId = useAgentStore((s) => s.highlightedTimelineId);

  const [filter, setFilter] = useState<TimelineFilterState>(defaultFilterState);
  const [showFilter, setShowFilter] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const prevCountRef = useRef<number>(0);

  // ── Manual scroll tracking ─────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;
  }, []);

  // ── Auto-scroll when new events arrive ────────────────────────────────────
  useEffect(() => {
    const newCount = timelineEvents.length;
    if (newCount > prevCountRef.current && isAtBottomRef.current) {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = newCount;
  }, [timelineEvents.length]);

  // ── Scroll highlighted row into view ─────────────────────────────────────
  useEffect(() => {
    if (highlightedTimelineId === null) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-timeline-id="${highlightedTimelineId}"]`,
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [highlightedTimelineId]);

  // ── Filtered + searched events (memoised) ─────────────────────────────────
  const filteredEvents = useMemo(() => {
    const lower = filter.searchText.toLowerCase();
    return timelineEvents.filter((ev) => {
      if (!filter.enabledTypes.has(ev.eventType)) return false;
      if (lower === '') return true;
      return eventSummaryText(ev).toLowerCase().includes(lower);
    });
  }, [timelineEvents, filter]);

  // ── Collapsed icon strip ──────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="
          flex flex-col items-center py-3 gap-3
          bg-[#0f0f14] border-l border-white/8
          w-10 shrink-0
        "
        style={{ transition: 'width 200ms ease' }}
      >
        <button
          id="timeline-toggle-collapsed"
          onClick={onToggle}
          title="Expand Timeline"
          className="text-white/30 hover:text-white/70 transition-colors text-sm"
        >
          ◀
        </button>
        <div
          className="w-0.5 flex-1 bg-gradient-to-b from-violet-500/20 via-indigo-500/10 to-transparent rounded-full"
        />
        <span className="text-white/20 text-[10px] font-mono [writing-mode:vertical-rl] rotate-180">
          TRACE
        </span>
      </div>
    );
  }

  return (
    <div
      className="
        flex flex-col bg-[#0f0f14] border-l border-white/8
        w-[350px] shrink-0 overflow-hidden
      "
      style={{ transition: 'width 200ms ease' }}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-white/8">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white/60 uppercase tracking-widest font-mono">
            Trace
          </span>
          <span className="text-[10px] text-white/25 font-mono">
            {filteredEvents.length}/{timelineEvents.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Filter toggle */}
          <button
            id="timeline-filter-btn"
            onClick={() => setShowFilter((v) => !v)}
            title="Toggle filter"
            className={`
              text-xs px-2 py-0.5 rounded border transition-colors
              ${showFilter
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'text-white/30 border-white/10 hover:text-white/60'}
            `}
          >
            ⚙
          </button>

          {/* Collapse */}
          <button
            id="timeline-toggle-expanded"
            onClick={onToggle}
            title="Collapse Timeline"
            className="text-white/30 hover:text-white/70 transition-colors text-sm"
          >
            ▶
          </button>
        </div>
      </div>

      {/* Filter bar (conditionally shown) */}
      {showFilter && (
        <TimelineFilter filter={filter} onChange={setFilter} />
      )}

      {/* Event list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-1 space-y-0.5"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(99,102,241,0.2) transparent' }}
      >
        {filteredEvents.length === 0 && (
          <div className="flex items-center justify-center h-32 text-white/20 text-xs font-mono">
            {timelineEvents.length === 0 ? 'No events yet' : 'No matching events'}
          </div>
        )}

        {filteredEvents.map((event) => {
          if (event.eventType === 'token_batch') {
            return <TokenBatchRow key={event.id} event={event} />;
          }
          return <TimelineRow key={event.id} event={event} />;
        })}
      </div>
    </div>
  );
}
