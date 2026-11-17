/**
 * Buzzar: token buckets for world-script network traffic (parity checklist §7, "rate limits on script networking").
 * A world script, or a peer running a modified one, could otherwise flood every player's connection.
 */
export interface TokenBucket {
  tokens: number;
  last: number;
  /** Refill per second. */
  rate: number;
  /** Largest burst. */
  burst: number;
}

export function createTokenBucket(rate: number, burst: number, now: number): TokenBucket {
  return { tokens: burst, last: now, rate, burst };
}

/** Takes `cost` tokens if available. `now` is in milliseconds. */
export function takeTokens(bucket: TokenBucket, cost: number, now: number): boolean {
  const elapsed = Math.max(0, now - bucket.last) / 1000;
  bucket.last = now;
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsed * bucket.rate);
  if (bucket.tokens < cost) return false;
  bucket.tokens -= cost;
  return true;
}

/** Message count and byte limits together. */
export interface MessageLimiter {
  messages: TokenBucket;
  bytes: TokenBucket;
  lastWarning: number;
}

export function createMessageLimiter(
  messagesPerSecond: number,
  bytesPerSecond: number,
  now: number,
  burstSeconds = 2
): MessageLimiter {
  return {
    messages: createTokenBucket(messagesPerSecond, messagesPerSecond * burstSeconds, now),
    bytes: createTokenBucket(bytesPerSecond, bytesPerSecond * burstSeconds, now),
    lastWarning: -Infinity,
  };
}

/** True if a message of `byteLength` bytes may go through now; takes from both buckets only when it does. */
export function allowMessage(limiter: MessageLimiter, byteLength: number, now: number): boolean {
  // Refill both first, then check both, so a refused message costs nothing.
  takeTokens(limiter.messages, 0, now);
  takeTokens(limiter.bytes, 0, now);
  if (limiter.messages.tokens < 1 || limiter.bytes.tokens < byteLength) return false;
  limiter.messages.tokens -= 1;
  limiter.bytes.tokens -= byteLength;
  return true;
}

/** True at most once every `intervalMs`, for logging a warning about dropped messages without flooding the console. */
export function shouldWarn(limiter: MessageLimiter, now: number, intervalMs = 5000): boolean {
  if (now - limiter.lastWarning < intervalMs) return false;
  limiter.lastWarning = now;
  return true;
}

/** Outbound, per world script. */
export const SCRIPT_SEND_MESSAGES_PER_SECOND = 30;
export const SCRIPT_SEND_BYTES_PER_SECOND = 32 * 1024;
/** Inbound, per peer: twice the outbound limits, so a well-behaved script at its cap is never cut off. */
export const SCRIPT_RECEIVE_MESSAGES_PER_SECOND = 60;
export const SCRIPT_RECEIVE_BYTES_PER_SECOND = 64 * 1024;
