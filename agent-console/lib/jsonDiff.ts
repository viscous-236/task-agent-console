import type { DiffNode, DiffType } from '@/lib/types';

const MAX_DEPTH = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compute a structural diff between two plain objects.
 *
 * Returns a flat array of DiffNode at the top level; nested plain-object
 * differences are recursed into (up to MAX_DEPTH = 20 levels deep).
 *
 * Implemented iteratively via an explicit work stack to avoid call-stack
 * overflow on large (500 KB+) payloads.
 */
export function diffJson(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
): DiffNode[] {
  // Work stack item: the two objects to compare and where to push results
  interface WorkItem {
    oldO: Record<string, unknown>;
    newO: Record<string, unknown>;
    depth: number;
    target: DiffNode[];   // array to push results into
  }

  const topLevel: DiffNode[] = [];
  const stack: WorkItem[] = [{ oldO: oldObj, newO: newObj, depth: 0, target: topLevel }];

  while (stack.length > 0) {
    // Non-null assertion safe: we just checked stack.length > 0
    const item = stack.pop()!;
    const { oldO, newO, depth, target } = item;

    const allKeys = new Set([...Object.keys(oldO), ...Object.keys(newO)]);

    for (const key of allKeys) {
      const inOld = Object.prototype.hasOwnProperty.call(oldO, key);
      const inNew = Object.prototype.hasOwnProperty.call(newO, key);

      if (inNew && !inOld) {
        target.push({ key, diffType: 'added' as DiffType, newValue: newO[key] });
        continue;
      }

      if (inOld && !inNew) {
        target.push({ key, diffType: 'removed' as DiffType, oldValue: oldO[key] });
        continue;
      }

      // Both present
      const oldVal = oldO[key];
      const newVal = newO[key];

      if (deepEqual(oldVal, newVal)) {
        target.push({ key, diffType: 'unchanged' as DiffType, newValue: newVal });
        continue;
      }

      // Values differ
      if (depth < MAX_DEPTH && isPlainObject(oldVal) && isPlainObject(newVal)) {
        // Recurse into nested objects — push onto work stack
        const children: DiffNode[] = [];
        target.push({ key, diffType: 'changed' as DiffType, oldValue: oldVal, newValue: newVal, children });
        stack.push({ oldO: oldVal, newO: newVal, depth: depth + 1, target: children });
      } else {
        // Scalar or depth exceeded — treat as leaf change
        target.push({ key, diffType: 'changed' as DiffType, oldValue: oldVal, newValue: newVal });
      }
    }
  }

  return topLevel;
}
