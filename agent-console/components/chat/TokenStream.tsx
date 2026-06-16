'use client';

import React, { memo } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { StreamSegment } from '@/lib/types';
import { ToolCallCard } from './ToolCallCard';

// ─── Individual segment renderers (memoised to prevent list-wide re-renders) ──

interface TextSegmentProps {
  content: string;
}

const TextSegment = memo(function TextSegment({ content }: TextSegmentProps) {
  return (
    <span
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      className="text-gray-100 leading-relaxed"
    >
      {content}
    </span>
  );
});
TextSegment.displayName = 'TextSegment';

interface ToolCallSegmentProps {
  call_id: string;
}

const ToolCallSegment = memo(function ToolCallSegment({ call_id }: ToolCallSegmentProps) {
  return <ToolCallCard call_id={call_id} />;
});
ToolCallSegment.displayName = 'ToolCallSegment';

// ─── Segment list (stable render list, each item memoised) ────────────────────

interface SegmentListProps {
  segments: StreamSegment[];
}

const SegmentList = memo(function SegmentList({ segments }: SegmentListProps) {
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.kind === 'text') {
          return <TextSegment key={idx} content={seg.content} />;
        }
        return <ToolCallSegment key={seg.call_id} call_id={seg.call_id} />;
      })}
    </>
  );
});
SegmentList.displayName = 'SegmentList';

// ─── Blinking cursor ──────────────────────────────────────────────────────────

function BlinkingCursor() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 align-middle animate-pulse"
    />
  );
}

// ─── TokenStream ──────────────────────────────────────────────────────────────

interface TokenStreamProps {
  stream_id: string;
}

/**
 * TokenStream — renders a live agent message stream.
 *
 * Uses `contain: layout` on the streaming text container so tool card
 * insertion below does NOT reflow or push existing text upward.
 */
export const TokenStream = memo(function TokenStream({ stream_id }: TokenStreamProps) {
  const agentMsg = useAgentStore((s) =>
    s.messages.find((m) => m.role === 'assistant' && m.id === stream_id),
  );

  if (!agentMsg || agentMsg.role !== 'assistant') return null;

  return (
    <div
      className="flex flex-col gap-2"
      // contain: layout prevents tool-card insertion from reflowing the text above
      style={{ contain: 'layout' }}
    >
      <div className="leading-relaxed">
        <SegmentList segments={agentMsg.segments} />
        {!agentMsg.isComplete && <BlinkingCursor />}
      </div>
    </div>
  );
});
TokenStream.displayName = 'TokenStream';
