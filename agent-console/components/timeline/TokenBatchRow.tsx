'use client';

import React, { memo, useState } from 'react';
import type { TokenBatchEvent } from '@/lib/types';

interface TokenBatchRowProps {
  event: TokenBatchEvent;
}

export const TokenBatchRow = memo(function TokenBatchRow({ event }: TokenBatchRowProps) {
  const [expanded, setExpanded] = useState(false);

  const durationSec = (event.durationMs / 1000).toFixed(1);

  return (
    <div className="rounded-md border border-transparent hover:border-white/8 transition-colors">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="
          w-full flex items-center gap-2 px-3 py-1.5 text-xs
          text-white/50 hover:text-white/70 transition-colors duration-150
          text-left
        "
        aria-expanded={expanded}
      >
        {/* Chevron */}
        <span
          className={`shrink-0 transition-transform duration-150 text-white/30 ${expanded ? 'rotate-90' : ''}`}
        >
          ▶
        </span>

        {/* Token badge */}
        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono bg-violet-500/20 text-violet-300 border border-violet-500/30">
          TOKENS
        </span>

        {/* Summary */}
        <span className="flex-1 font-mono text-white/60 truncate">
          Streamed {event.tokenCount} token{event.tokenCount !== 1 ? 's' : ''} ({durationSec}s)
        </span>

        <span className="shrink-0 text-white/25 tabular-nums">
          {event.stream_id.slice(-6)}
        </span>
      </button>

      {/* Expanded text */}
      {expanded && (
        <div className="px-3 pb-2">
          <pre
            className="
              text-xs font-mono text-violet-200/80 bg-violet-950/30
              border border-violet-500/20 rounded-md px-3 py-2
              overflow-x-auto overflow-y-auto max-h-48
              whitespace-pre-wrap break-words leading-relaxed
            "
          >
            {event.fullText}
          </pre>
        </div>
      )}
    </div>
  );
});
TokenBatchRow.displayName = 'TokenBatchRow';
