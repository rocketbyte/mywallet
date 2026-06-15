import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Gates the internal/admin Gmail routes (status/:userId, link, unlink) behind a
 * shared `x-admin-key` credential, compared in constant time against
 * ADMIN_API_KEY. Fails closed: when ADMIN_API_KEY is not configured the routes
 * are denied entirely, so they can never be reached unprotected. This is an
 * interim gate until a first-class tenant role model exists.
 */
export function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const expected = config.admin.apiKey;
  if (!expected) {
    logger.warn('Admin route blocked: ADMIN_API_KEY not configured', { path: req.path });
    res.status(403).json({ error: 'Forbidden', message: 'Admin access is not configured' });
    return;
  }

  const provided = firstHeaderValue(req.headers['x-admin-key']);
  if (!provided || !safeEqual(provided, expected)) {
    logger.warn('Admin route blocked: invalid or missing x-admin-key', { path: req.path });
    res.status(403).json({ error: 'Forbidden', message: 'Admin credential required' });
    return;
  }

  next();
}
