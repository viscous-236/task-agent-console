'use client';

import React, { useRef, useEffect, useState, useCallback, KeyboardEvent } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import type { UseWebSocketReturn } from '@/hooks/useWebSocket';
import { MessageBubble } from './MessageBubble';

interface ChatPanelProps {
  ws: UseWebSocketReturn;
}

const SCROLL_THRESHOLD = 80; // px from bottom before we consider user "scrolled up"

export function ChatPanel({ ws }: ChatPanelProps) {
  const messages = useAgentStore((s) => s.messages);
  const connectionState = useAgentStore((s) => s.connectionState);
  const addUserMessage = useAgentStore((s) => s.addUserMessage);

  const [inputValue, setInputValue] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const prevMessageCountRef = useRef<number>(0);

  // ── Track whether the user has scrolled up ─────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom <= SCROLL_THRESHOLD;
  }, []);

  // ── Auto-scroll only when a new MESSAGE is added (not on every token) ──────
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const newCount = messages.length;
    if (newCount > prevMessageCountRef.current && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCountRef.current = newCount;
  }, [messages.length]);

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const content = inputValue.trim();
    if (!content) return;

    addUserMessage(content);
    ws.send({ type: 'USER_MESSAGE', content });
    setInputValue('');

    // Scroll to bottom after sending
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    isAtBottomRef.current = true;
  }, [inputValue, addUserMessage, ws]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isDisabled =
    connectionState === 'reconnecting' || connectionState === 'closed' || connectionState === 'idle';

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* ── Message list ──────────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1 scroll-smooth"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(99,102,241,0.3) transparent' }}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-900/40">
              ✦
            </div>
            <p className="text-white/50 text-sm">
              Send a message to start a session.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* ── Input area ────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pb-4 pt-2 border-t border-white/8">
        <div
          className={`
            flex items-end gap-2 rounded-xl border bg-white/5 px-3 py-2
            transition-colors duration-200
            ${isDisabled
              ? 'border-white/5 opacity-50 cursor-not-allowed'
              : 'border-white/15 hover:border-indigo-500/40 focus-within:border-indigo-500/60'}
          `}
        >
          <textarea
            id="chat-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isDisabled}
            rows={1}
            placeholder={
              connectionState === 'reconnecting'
                ? 'Reconnecting…'
                : 'Message agent  ·  Enter to send, Shift+Enter for newline'
            }
            className="
              flex-1 bg-transparent resize-none outline-none
              text-sm text-white placeholder-white/30
              leading-relaxed py-1 max-h-40 overflow-y-auto
              disabled:cursor-not-allowed
            "
            style={{ scrollbarWidth: 'none' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            id="chat-send-btn"
            onClick={handleSubmit}
            disabled={isDisabled || !inputValue.trim()}
            aria-label="Send message"
            className="
              shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
              bg-indigo-600 text-white text-sm font-bold
              hover:bg-indigo-500 active:scale-95 transition-all duration-150
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600
            "
          >
            ↑
          </button>
        </div>
        <p className="text-xs text-white/20 mt-1.5 pl-1">
          {connectionState === 'streaming' && (
            <span className="text-indigo-400 animate-pulse">● Streaming…</span>
          )}
          {connectionState === 'tool_call_pending' && (
            <span className="text-yellow-400">⚙ Tool running…</span>
          )}
          {connectionState === 'connected' && (
            <span className="text-green-400/60">● Connected</span>
          )}
          {connectionState === 'reconnecting' && (
            <span className="text-red-400">↺ Reconnecting…</span>
          )}
        </p>
      </div>
    </div>
  );
}
