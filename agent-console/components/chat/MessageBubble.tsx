'use client';

import React, { memo } from 'react';
import type { ChatMessage } from '@/lib/types';
import { TokenStream } from './TokenStream';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="
            max-w-[75%] px-4 py-3 rounded-2xl rounded-tr-sm
            bg-indigo-600 text-white text-sm leading-relaxed
            shadow-lg shadow-indigo-900/30
          "
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  // Agent message — left-aligned, uses TokenStream
  return (
    <div className="flex justify-start mb-4">
      {/* Avatar dot */}
      <div className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white mr-3 mt-0.5 shadow-md">
        A
      </div>
      <div
        className="
          max-w-[80%] px-4 py-3 rounded-2xl rounded-tl-sm
          bg-white/6 border border-white/10 text-sm
          shadow-md
        "
      >
        <TokenStream stream_id={message.id} />
      </div>
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';
