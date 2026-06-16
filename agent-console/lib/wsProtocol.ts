import type {
  ServerMessage,
  ClientMessage,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
  ContextSnapshotMessage,
  PingMessage,
  StreamEndMessage,
  ErrorMessage,
} from '@/lib/types';

// ─── Known message types ───────────────────────────────────────────────────────

const KNOWN_SERVER_TYPES = new Set<string>([
  'TOKEN',
  'TOOL_CALL',
  'TOOL_RESULT',
  'CONTEXT_SNAPSHOT',
  'PING',
  'STREAM_END',
  'ERROR',
]);

// ─── Type guard ────────────────────────────────────────────────────────────────

export function isKnownMessageType(type: string): type is ServerMessage['type'] {
  return KNOWN_SERVER_TYPES.has(type);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Parse a raw JSON string into a typed ServerMessage.
 * Returns null for any malformed or unknown input — never throws.
 * Strips unknown extra fields; returns only the typed subset.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) return null;

    const { type, seq } = parsed;

    if (typeof type !== 'string') return null;
    if (!isKnownMessageType(type)) return null;
    if (!isNonNegativeInteger(seq)) return null;

    switch (type) {
      case 'TOKEN': {
        const { text, stream_id } = parsed;
        if (typeof text !== 'string') return null;
        if (typeof stream_id !== 'string') return null;
        const msg: TokenMessage = { type: 'TOKEN', seq, text, stream_id };
        return msg;
      }

      case 'TOOL_CALL': {
        const { call_id, tool_name, args, stream_id } = parsed;
        if (typeof call_id !== 'string') return null;
        if (typeof tool_name !== 'string') return null;
        if (!isRecord(args)) return null;
        if (typeof stream_id !== 'string') return null;
        const msg: ToolCallMessage = {
          type: 'TOOL_CALL',
          seq,
          call_id,
          tool_name,
          args,
          stream_id,
        };
        return msg;
      }

      case 'TOOL_RESULT': {
        const { call_id, result, stream_id } = parsed;
        if (typeof call_id !== 'string') return null;
        if (!isRecord(result)) return null;
        if (typeof stream_id !== 'string') return null;
        const msg: ToolResultMessage = {
          type: 'TOOL_RESULT',
          seq,
          call_id,
          result,
          stream_id,
        };
        return msg;
      }

      case 'CONTEXT_SNAPSHOT': {
        const { context_id, data } = parsed;
        if (typeof context_id !== 'string') return null;
        if (!isRecord(data)) return null;
        const msg: ContextSnapshotMessage = {
          type: 'CONTEXT_SNAPSHOT',
          seq,
          context_id,
          data,
        };
        return msg;
      }

      case 'PING': {
        const { challenge } = parsed;
        // challenge may be empty string — that is valid per spec
        if (typeof challenge !== 'string') return null;
        const msg: PingMessage = { type: 'PING', seq, challenge };
        return msg;
      }

      case 'STREAM_END': {
        const { stream_id } = parsed;
        if (typeof stream_id !== 'string') return null;
        const msg: StreamEndMessage = { type: 'STREAM_END', seq, stream_id };
        return msg;
      }

      case 'ERROR': {
        const { code, message } = parsed;
        if (typeof code !== 'string') return null;
        if (typeof message !== 'string') return null;
        const msg: ErrorMessage = { type: 'ERROR', seq, code, message };
        return msg;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * Serialize a ClientMessage to a JSON string. Never throws.
 */
export function serializeClientMessage(msg: ClientMessage): string {
  try {
    return JSON.stringify(msg);
  } catch {
    // Fallback: should not happen with well-typed ClientMessage values
    return '{}';
  }
}
