'use client';

import React, { useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { ContextScrubber } from './ContextScrubber';
import { ContextDiff } from './ContextDiff';
import { ContextTree } from './ContextTree';

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ContextPanel() {
  const contextSnapshots = useAgentStore((s) => s.contextSnapshots);
  const contextViewIndex = useAgentStore((s) => s.contextViewIndex);

  const contextIds = Object.keys(contextSnapshots);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select the first context_id when one appears
  const activeId = selectedId ?? contextIds[0] ?? null;

  if (contextIds.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-center px-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 text-lg border border-blue-500/20">
          ◈
        </div>
        <p className="text-xs text-white/30 font-mono">
          No context snapshots received yet.
        </p>
      </div>
    );
  }

  const snapshots = activeId ? (contextSnapshots[activeId] ?? []) : [];
  const viewIndex = activeId ? (contextViewIndex[activeId] ?? 0) : 0;
  const currentSnap = snapshots[viewIndex];
  const prevSnap = viewIndex > 0 ? snapshots[viewIndex - 1] : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-white/8 overflow-x-auto">
        {contextIds.map((id) => (
          <button
            key={id}
            id={`ctx-tab-${id}`}
            onClick={() => setSelectedId(id)}
            className={`
              shrink-0 text-xs font-mono px-2.5 py-1 rounded-md border transition-all duration-150
              ${activeId === id
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                : 'bg-transparent text-white/35 border-white/10 hover:border-white/20 hover:text-white/60'}
            `}
          >
            {id}
          </button>
        ))}
      </div>

      {activeId !== null && currentSnap !== undefined ? (
        <>
          {/* Scrubber */}
          <ContextScrubber context_id={activeId} />

          {/* Meta: seq + timestamp */}
          <div className="shrink-0 flex items-center gap-4 px-3 py-1.5 text-[10px] font-mono text-white/25 border-b border-white/6">
            <span>seq: {currentSnap.seq}</span>
            <span>·</span>
            <span>{formatTimestamp(currentSnap.timestamp)}</span>
          </div>

          {/* Tree or Diff */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {viewIndex === 0 || prevSnap === null || prevSnap === undefined ? (
              // First snapshot — no previous to diff against
              <ContextTree data={currentSnap.data} />
            ) : (
              <ContextDiff
                prev={prevSnap.data}
                curr={currentSnap.data}
              />
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-white/25 font-mono">
          Select a context tab
        </div>
      )}
    </div>
  );
}
