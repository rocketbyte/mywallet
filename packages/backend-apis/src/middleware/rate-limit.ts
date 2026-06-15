import rateLimit, { type Options } from 'express-rate-limit';

const TOO_MANY = { error: 'TooManyRequests', message: 'Rate limit exceeded — slow down and retry shortly.' };

const base: Partial<Options> = {
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
  message: TOO_MANY,
};

/**
 * Baseline limiter applied to every route. Generous enough for normal app use;
 * exists to blunt scraping and brute-force against the whole surface.
 */
export const baselineLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 300,
});

/**
 * Stricter limiter for unauthenticated, externally-reachable endpoints
 * (Gmail webhook, OAuth callback) where a flood is pure abuse.
 */
export const publicEndpointLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 60,
});

/**
 * Tight limiter for the LLM-backed chat endpoint, where each request costs
 * model tokens. Keyed per authenticated user when available, else per IP.
 */
export const chatLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
});
