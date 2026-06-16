'use client';

import React, { memo, useCallback } from 'react';
import { useAgentStore } from '@/store/useAgentStore';

// ─── Status badge ─────────────────────────────────────────────────────────────

type StatusColor = 'yellow' | 'blue' | 'green';

const STATUS_CONFIG: Record<string, { label: string; color: StatusColor }> = {
  pending:         { label: 'Pending',         color: 'yellow' },
  acked:           { label: 'Acknowledged',    color: 'blue'   },
  result_received: { label: 'Result Received', color: 'green'  },
};

const COLOR_CLASSES: Record<StatusColor, string> = {
  yellow: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  blue:   'bg-blue-500/20   text-blue-300   border border-blue-500/30',
  green:  'bg-green-500/20  text-green-300  border border-green-500/30',
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, color: 'yellow' as StatusColor };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${COLOR_CLASSES[config.color]}`}
    >
      {config.label}
    </span>
  );
}

// ─── ToolCallCard ──────────────────────────────────────────────────────────────

interface ToolCallCardProps {
  call_id: string;
}

export const ToolCallCard = memo(function ToolCallCard({ call_id }: ToolCallCardProps) {
  // Find the AgentMessage that owns this call_id
  const record = useAgentStore((s) => {
    for (const msg of s.messages) {
      if (msg.role !== 'assistant') continue;
      const r = msg.toolCalls[call_id];
      if (r !== undefined) return r;
    }
    return null;
  });

  const isHighlighted = useAgentStore((s) => s.highlightedCallId === call_id);
  const setHighlightedCallId = useAgentStore((s) => s.setHighlightedCallId);
  const setHighlightedTimelineId = useAgentStore((s) => s.setHighlightedTimelineId);

  const handleClick = useCallback(() => {
    setHighlightedCallId(call_id);
    // Timeline ID for a tool call event is not tracked here; clearing it is fine
    // (timeline panel will set it on its own click). Only set chat-side highlight.
    setHighlightedTimelineId(null);
  }, [call_id, setHighlightedCallId, setHighlightedTimelineId]);

  if (!record) return null;

  const isResultReceived = record.status === 'result_received';

  return (
    <div
      data-call-id={call_id}
      onClick={handleClick}
      className={`
        my-3 rounded-lg border cursor-pointer transition-all duration-200
        ${isHighlighted
          ? 'border-indigo-500 bg-indigo-950/60 shadow-lg shadow-indigo-500/10'
          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
        }
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          {/* Tool icon */}
          <span className="text-indigo-400 shrink-0">⚙</span>
          <code className="font-mono text-sm text-indigo-300 font-semibold truncate">
            {record.tool_name}
          </code>
          <span className="font-mono text-xs text-white/30 shrink-0">#{call_id.slice(-6)}</span>
        </div>
        <StatusBadge status={record.status} />
      </div>

      {/* Args */}
      <div className="px-4 py-2.5">
        <p className="text-xs text-white/40 font-medium uppercase tracking-wider mb-1.5">Arguments</p>
        <pre className="text-xs font-mono text-gray-300 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {JSON.stringify(record.args, null, 2)}
        </pre>
      </div>

      {/* Result — shown only when result_received */}
      {isResultReceived && record.result !== null && (
        <div className="px-4 py-2.5 border-t border-green-500/20 bg-green-950/20">
          <p className="text-xs text-green-400/60 font-medium uppercase tracking-wider mb-1.5">Result</p>
          <pre className="text-xs font-mono text-green-300 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
            {JSON.stringify(record.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
});
ToolCallCard.displayName = 'ToolCallCard';
