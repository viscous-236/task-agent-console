'use client';

import React, { useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { usePing } from '@/hooks/usePing';
import { useAgentStore } from '@/store/useAgentStore';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';
import { ContextPanel } from '@/components/context/ContextPanel';
import { ReconnectBanner } from '@/components/shared/ReconnectBanner';
import { ConnectionStatus } from '@/components/shared/ConnectionStatus';

export default function AppShell() {
  const ws = useWebSocket();
  usePing(); // informational watchdog — called at same level as useWebSocket

  const resetSession = useAgentStore((s) => s.resetSession);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);

  function handleReset() {
    resetSession();
    ws.disconnect();
    // Reconnect fresh after a tick so disconnect settles first
    setTimeout(() => window.location.reload(), 50);
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090d] text-white overflow-hidden">
      {/* ── Reconnect banner (fixed, non-blocking) ─────────────────────── */}
      <ReconnectBanner />

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/8 bg-[#0c0c12]/80 backdrop-blur-sm z-10">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold shadow-md shadow-indigo-900/40">
            ✦
          </div>
          <h1 className="text-sm font-semibold text-white/80 tracking-wide">
            Agent Console
          </h1>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          <ConnectionStatus />

          <button
            id="reset-session-btn"
            onClick={handleReset}
            title="Reset session"
            className="
              text-xs px-2.5 py-1 rounded-md border border-white/10
              text-white/40 hover:text-white/70 hover:border-white/20
              transition-colors duration-150 font-mono
            "
          >
            ↺ Reset
          </button>
        </div>
      </header>

      {/* ── Three-column body ──────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Timeline (collapsible, 350px ↔ 40px) */}
        <TimelinePanel
          collapsed={timelineCollapsed}
          onToggle={() => setTimelineCollapsed((v) => !v)}
        />

        {/* Center: Chat (flex-grow) */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden border-x border-white/6">
          <ChatPanel ws={ws} />
        </main>

        {/* Right: Context Inspector (320px fixed) */}
        <aside
          className="
            w-[320px] shrink-0 flex flex-col overflow-hidden
            bg-[#0c0c12] border-l border-white/8
          "
        >
          {/* Context header */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
            <span className="text-xs font-bold text-white/50 uppercase tracking-widest font-mono">
              Context
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ContextPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
