export const WS_URL = 'ws://localhost:4747/ws';
export const PONG_TIMEOUT_MS = 3000;          // server requires PONG within 3s
export const TOOL_ACK_TIMEOUT_MS = 2000;      // spec says send within 2s
export const RECONNECT_BACKOFF_BASE_MS = 500;
export const RECONNECT_BACKOFF_MAX_MS = 10000;
export const RECONNECT_BACKOFF_MULTIPLIER = 2;
export const RECONNECT_INDICATOR_DELAY_MS = 500;  // show indicator within 500ms
