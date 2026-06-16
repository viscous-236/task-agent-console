import { parseServerMessage, serializeClientMessage } from '@/lib/wsProtocol';
import type {
  TokenMessage,
  ToolCallMessage,
  PingMessage,
  ClientMessage,
} from '@/lib/types';

describe('parseServerMessage', () => {
  // 1. Valid TOKEN message parses correctly
  it('parses a valid TOKEN message', () => {
    const raw = JSON.stringify({ type: 'TOKEN', seq: 0, text: 'hello', stream_id: 's1' });
    const msg = parseServerMessage(raw) as TokenMessage | null;
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('TOKEN');
    expect(msg?.seq).toBe(0);
    expect(msg?.text).toBe('hello');
    expect(msg?.stream_id).toBe('s1');
  });

  // 2. Valid TOOL_CALL with args parses correctly
  it('parses a valid TOOL_CALL message with nested args', () => {
    const raw = JSON.stringify({
      type: 'TOOL_CALL',
      seq: 5,
      call_id: 'call-abc',
      tool_name: 'search',
      args: { query: 'test', limit: 10 },
      stream_id: 's2',
      extraField: 'should be stripped',
    });
    const msg = parseServerMessage(raw) as ToolCallMessage | null;
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('TOOL_CALL');
    expect(msg?.call_id).toBe('call-abc');
    expect(msg?.tool_name).toBe('search');
    expect(msg?.args).toEqual({ query: 'test', limit: 10 });
    // Extra fields must be stripped — the returned object should not have them
    expect((msg as unknown as Record<string, unknown>)?.['extraField']).toBeUndefined();
  });

  // 3. Valid PING with empty challenge parses as PingMessage (not null)
  it('parses a PING with an empty challenge string as a valid PingMessage', () => {
    const raw = JSON.stringify({ type: 'PING', seq: 2, challenge: '' });
    const msg = parseServerMessage(raw) as PingMessage | null;
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe('PING');
    expect(msg?.challenge).toBe('');
  });

  // 4. Unknown type returns null
  it('returns null for an unknown message type', () => {
    const raw = JSON.stringify({ type: 'UNKNOWN_TYPE', seq: 0 });
    expect(parseServerMessage(raw)).toBeNull();
  });

  // 5. Missing seq field returns null
  it('returns null when seq is missing', () => {
    const raw = JSON.stringify({ type: 'TOKEN', text: 'hi', stream_id: 's1' });
    expect(parseServerMessage(raw)).toBeNull();
  });

  // 6. Malformed JSON string returns null
  it('returns null for malformed JSON without throwing', () => {
    expect(() => parseServerMessage('not json {{')).not.toThrow();
    expect(parseServerMessage('not json {{')).toBeNull();
  });

  // Additional: negative seq returns null
  it('returns null when seq is negative', () => {
    const raw = JSON.stringify({ type: 'TOKEN', seq: -1, text: 'hi', stream_id: 's1' });
    expect(parseServerMessage(raw)).toBeNull();
  });
});

describe('serializeClientMessage', () => {
  // 7. serializeClientMessage for each ClientMessage type produces valid parseable JSON
  const cases: ClientMessage[] = [
    { type: 'USER_MESSAGE', content: 'Hello agent' },
    { type: 'PONG', echo: 'abc123' },
    { type: 'PONG', echo: '' },  // empty echo (empty challenge scenario)
    { type: 'RESUME', last_seq: 42 },
    { type: 'TOOL_ACK', call_id: 'call-xyz' },
  ];

  it.each(cases)('serializes %o to parseable JSON', (msg: ClientMessage) => {
    const serialized = serializeClientMessage(msg);
    expect(typeof serialized).toBe('string');
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed: unknown = JSON.parse(serialized);
    expect((parsed as Record<string, unknown>)['type']).toBe(msg.type);
  });
});
