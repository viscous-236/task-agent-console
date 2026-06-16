'use client';

import React, { memo, useReducer, useCallback } from 'react';
import type { DiffNode, DiffType } from '@/lib/types';

// ─── Expanded-paths state (useReducer, lives at tree root) ────────────────────

type ExpandAction = { type: 'toggle'; path: string };

function expandReducer(state: Set<string>, action: ExpandAction): Set<string> {
  const next = new Set(state);
  if (next.has(action.path)) {
    next.delete(action.path);
  } else {
    next.add(action.path);
  }
  return next;
}

// ─── Diff tint classes ────────────────────────────────────────────────────────

const DIFF_TINT: Record<DiffType, string> = {
  added:     'bg-green-500/10 border-l-2 border-green-500/50 pl-1',
  removed:   'bg-red-500/10   border-l-2 border-red-500/50   pl-1 line-through opacity-60',
  changed:   'bg-yellow-500/10 border-l-2 border-yellow-500/50 pl-1',
  unchanged: '',
};

// ─── Value colour ─────────────────────────────────────────────────────────────

function scalarSpan(value: unknown): React.ReactNode {
  if (value === null)             return <span className="text-gray-500">null</span>;
  if (typeof value === 'string')  return <span className="text-green-400">"{value}"</span>;
  if (typeof value === 'number')  return <span className="text-blue-400">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-orange-400">{String(value)}</span>;
  return <span className="text-white/50">{JSON.stringify(value)}</span>;
}

function summarize(value: unknown): string {
  if (Array.isArray(value))                           return `[${value.length} items]`;
  if (typeof value === 'object' && value !== null)    return `{${Object.keys(value as object).length} keys}`;
  return '';
}

function isExpandable(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

// ─── Tree node (memoised — only re-renders when props change) ─────────────────

interface TreeNodeProps {
  keyLabel: string;
  value: unknown;
  path: string;
  expanded: Set<string>;
  dispatch: React.Dispatch<ExpandAction>;
  diffType?: DiffType;
  diffChildren?: DiffNode[];
}

const TreeNode = memo(function TreeNode({
  keyLabel,
  value,
  path,
  expanded,
  dispatch,
  diffType,
  diffChildren,
}: TreeNodeProps) {
  const isOpen = expanded.has(path);
  const expandable = isExpandable(value);
  const tintClass = diffType ? DIFF_TINT[diffType] : '';

  const toggle = useCallback(() => {
    dispatch({ type: 'toggle', path });
  }, [dispatch, path]);

  // Build children entries (array or object keys)
  const childEntries: [string, unknown][] = [];
  if (isOpen && expandable) {
    if (Array.isArray(value)) {
      value.forEach((item, idx) => childEntries.push([String(idx), item]));
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
        childEntries.push([k, v]),
      );
    }
  }

  return (
    <div className={`text-xs font-mono leading-5 ${tintClass} rounded-sm`}>
      <div
        className={`flex items-baseline gap-1 ${expandable ? 'cursor-pointer hover:bg-white/4 rounded' : ''} px-0.5`}
        onClick={expandable ? toggle : undefined}
      >
        {/* Chevron */}
        {expandable ? (
          <span className={`text-white/30 w-3 shrink-0 transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Key */}
        <span className="text-white/50">{keyLabel}:</span>

        {/* Value / summary */}
        {!expandable && scalarSpan(value)}
        {expandable && !isOpen && (
          <span className="text-white/30 italic">{summarize(value)}</span>
        )}
        {expandable && isOpen && (
          <span className="text-white/20">{Array.isArray(value) ? '[' : '{'}</span>
        )}
      </div>

      {/* Children — only rendered when expanded (proportional DOM) */}
      {isOpen && expandable && (
        <div className="ml-5 border-l border-white/8 pl-2">
          {childEntries.map(([childKey, childVal]) => {
            const childPath = `${path}.${childKey}`;
            // Find matching diff child node (if available)
            const diffChild = diffChildren?.find((d) => d.key === childKey);
            return (
              <TreeNode
                key={childPath}
                keyLabel={childKey}
                value={childVal}
                path={childPath}
                expanded={expanded}
                dispatch={dispatch}
                diffType={diffChild?.diffType}
                diffChildren={diffChild?.children}
              />
            );
          })}
          <div className="text-white/20 pl-0.5">
            {Array.isArray(value) ? ']' : '}'}
          </div>
        </div>
      )}
    </div>
  );
});
TreeNode.displayName = 'TreeNode';

// ─── ContextTree (public) ─────────────────────────────────────────────────────

interface ContextTreeProps {
  data: Record<string, unknown>;
  diffNodes?: DiffNode[];   // top-level diff array, optional
}

export function ContextTree({ data, diffNodes }: ContextTreeProps) {
  const [expanded, dispatch] = useReducer(expandReducer, new Set<string>());

  const entries = Object.entries(data);

  if (entries.length === 0) {
    return <p className="text-xs text-white/30 font-mono px-2 py-3">{'{ }'}</p>;
  }

  return (
    <div className="overflow-y-auto overflow-x-auto px-2 py-2 max-h-full">
      {entries.map(([key, value]) => {
        const diffNode = diffNodes?.find((d) => d.key === key);
        return (
          <TreeNode
            key={key}
            keyLabel={key}
            value={value}
            path={key}
            expanded={expanded}
            dispatch={dispatch}
            diffType={diffNode?.diffType}
            diffChildren={diffNode?.children}
          />
        );
      })}
    </div>
  );
}
