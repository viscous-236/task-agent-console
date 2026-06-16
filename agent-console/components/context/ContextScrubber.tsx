'use client';

import React, { useCallback } from 'react';
import { useAgentStore } from '@/store/useAgentStore';

interface ContextScrubberProps {
  context_id: string;
}

export function ContextScrubber({ context_id }: ContextScrubberProps) {
  const snapshots = useAgentStore(
    (s) => s.contextSnapshots[context_id] ?? [],
  );
  const viewIndex = useAgentStore(
    (s) => s.contextViewIndex[context_id] ?? 0,
  );
  const setContextViewIndex = useAgentStore((s) => s.setContextViewIndex);

  const total = snapshots.length;
  const current = viewIndex + 1; // 1-based display

  const goTo = useCallback(
    (idx: number) => {
      setContextViewIndex(context_id, idx);
    },
    [context_id, setContextViewIndex],
  );

  const goPrev = useCallback(() => goTo(viewIndex - 1), [goTo, viewIndex]);
  const goNext = useCallback(() => goTo(viewIndex + 1), [goTo, viewIndex]);

  if (total === 0) {
    return (
      <div className="px-3 py-2 text-xs text-white/30 font-mono">
        No snapshots yet.
      </div>
    );
  }

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/8 bg-white/2">
      {/* Prev button */}
      <button
        id={`ctx-prev-${context_id}`}
        onClick={goPrev}
        disabled={viewIndex === 0}
        aria-label="Previous snapshot"
        className="
          text-xs px-2 py-1 rounded border border-white/10
          text-white/50 hover:text-white/80 hover:border-white/20
          disabled:opacity-25 disabled:cursor-not-allowed
          transition-colors font-mono
        "
      >
        ◀
      </button>

      {/* Range slider */}
      <input
        id={`ctx-scrubber-${context_id}`}
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={viewIndex}
        onChange={(e) => goTo(Number(e.target.value))}
        className="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
        aria-label={`Snapshot scrubber for ${context_id}`}
      />

      {/* Next button */}
      <button
        id={`ctx-next-${context_id}`}
        onClick={goNext}
        disabled={viewIndex >= total - 1}
        aria-label="Next snapshot"
        className="
          text-xs px-2 py-1 rounded border border-white/10
          text-white/50 hover:text-white/80 hover:border-white/20
          disabled:opacity-25 disabled:cursor-not-allowed
          transition-colors font-mono
        "
      >
        ▶
      </button>

      {/* Label */}
      <span className="shrink-0 text-xs font-mono text-white/40">
        Snapshot {current} of {total}
      </span>
    </div>
  );
}
