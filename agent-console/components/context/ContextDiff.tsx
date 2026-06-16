'use client';

import React, { useMemo } from 'react';
import { diffJson } from '@/lib/jsonDiff';
import type { DiffNode } from '@/lib/types';
import { ContextTree } from './ContextTree';

interface ContextDiffProps {
  prev: Record<string, unknown>;
  curr: Record<string, unknown>;
}

export function ContextDiff({ prev, curr }: ContextDiffProps) {
  // Memoised — only recomputes when prev or curr object references change
  const diffNodes: DiffNode[] = useMemo(
    () => diffJson(prev, curr),
    [prev, curr],
  );

  // Count diff categories for the summary bar
  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;
    let changed = 0;

    function walk(nodes: DiffNode[]) {
      for (const n of nodes) {
        if (n.diffType === 'added')   added++;
        else if (n.diffType === 'removed') removed++;
        else if (n.diffType === 'changed') changed++;
        if (n.children) walk(n.children);
      }
    }
    walk(diffNodes);
    return { added, removed, changed };
  }, [diffNodes]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Summary bar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 text-xs font-mono border-b border-white/8 bg-white/2">
        <span className="text-green-400">
          +{counts.added} added
        </span>
        <span className="text-white/20">·</span>
        <span className="text-red-400">
          −{counts.removed} removed
        </span>
        <span className="text-white/20">·</span>
        <span className="text-yellow-400">
          ~{counts.changed} changed
        </span>
      </div>

      {/* Tree with diff tinting */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ContextTree data={curr} diffNodes={diffNodes} />
      </div>
    </div>
  );
}
