import { diffJson } from '@/lib/jsonDiff';
import type { DiffNode } from '@/lib/types';

describe('diffJson', () => {
  // 1. Both objects identical → all nodes 'unchanged'
  it('marks all keys unchanged when both objects are identical', () => {
    const obj = { a: 1, b: 'hello', c: true };
    const result = diffJson(obj, obj);
    expect(result.every((n: DiffNode) => n.diffType === 'unchanged')).toBe(true);
    expect(result).toHaveLength(3);
  });

  // 2. Key added in new → 'added' node
  it('marks a key as added when it only exists in the new object', () => {
    const result = diffJson({ a: 1 }, { a: 1, b: 2 });
    const added = result.find((n: DiffNode) => n.key === 'b');
    expect(added).toBeDefined();
    expect(added?.diffType).toBe('added');
    expect(added?.newValue).toBe(2);
  });

  // 3. Key removed → 'removed' node
  it('marks a key as removed when it only exists in the old object', () => {
    const result = diffJson({ a: 1, b: 2 }, { a: 1 });
    const removed = result.find((n: DiffNode) => n.key === 'b');
    expect(removed).toBeDefined();
    expect(removed?.diffType).toBe('removed');
    expect(removed?.oldValue).toBe(2);
  });

  // 4. Value changed (scalar) → 'changed' node with both values
  it('marks a scalar change with both oldValue and newValue', () => {
    const result = diffJson({ x: 10 }, { x: 99 });
    expect(result).toHaveLength(1);
    expect(result[0]?.diffType).toBe('changed');
    expect(result[0]?.oldValue).toBe(10);
    expect(result[0]?.newValue).toBe(99);
  });

  // 5. Nested object change → 'changed' parent with 'children' array
  it('recurses into nested objects and produces children', () => {
    const result = diffJson(
      { nested: { x: 1, y: 2 } },
      { nested: { x: 1, y: 99 } },
    );
    expect(result).toHaveLength(1);
    const nestedNode = result[0]!;
    expect(nestedNode.key).toBe('nested');
    expect(nestedNode.diffType).toBe('changed');
    expect(Array.isArray(nestedNode.children)).toBe(true);

    const children = nestedNode.children!;
    const xNode = children.find((c: DiffNode) => c.key === 'x');
    const yNode = children.find((c: DiffNode) => c.key === 'y');
    expect(xNode?.diffType).toBe('unchanged');
    expect(yNode?.diffType).toBe('changed');
    expect(yNode?.oldValue).toBe(2);
    expect(yNode?.newValue).toBe(99);
  });

  // 6. Empty old, populated new → all 'added'
  it('marks all keys as added when old object is empty', () => {
    const result = diffJson({}, { a: 1, b: 2, c: 3 });
    expect(result).toHaveLength(3);
    expect(result.every((n: DiffNode) => n.diffType === 'added')).toBe(true);
  });

  // 7. Populated old, empty new → all 'removed'
  it('marks all keys as removed when new object is empty', () => {
    const result = diffJson({ a: 1, b: 2, c: 3 }, {});
    expect(result).toHaveLength(3);
    expect(result.every((n: DiffNode) => n.diffType === 'removed')).toBe(true);
  });
});
