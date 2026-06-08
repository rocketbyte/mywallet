import winston from 'winston';
import { config } from '../config/environment';

export const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      )
    })
  ]
});

// Keys whose values are secrets or tokens and must never reach the logs.
// Compared case-insensitively against object keys.
const REDACTED_KEYS = new Set([
  'authorization',
  'refreshtoken',
  'currentaccesstoken',
  'accesstoken',
  'access_token',
  'refresh_token',
  'code',
  'password',
  'privatekey',
  'private_key',
  'token',
  'idtoken',
  'id_token',
  'x-admin-key',
  'x-api-key',
]);

const REDACTED = '[REDACTED]';

/**
 * Deep-clones `value`, replacing any secret-bearing field (see REDACTED_KEYS)
 * with a placeholder so request bodies/headers can be logged without leaking
 * OAuth tokens, credentials, or bearer tokens. Guards against cycles and caps
 * recursion depth so a hostile payload can't blow the stack.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[Truncated]';
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}
