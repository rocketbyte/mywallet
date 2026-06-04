import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function docsAuth(req: Request, res: Response, next: NextFunction) {
  const { user, password } = config.docs;

  if (!user || !password) {
    logger.warn('Docs request blocked: DOCS_USER/DOCS_PASSWORD not configured');
    res.status(503).json({ error: 'Docs auth not configured' });
    return;
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MyWallet Docs", charset="UTF-8"');
    res.status(401).send('Authentication required');
    return;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const idx = decoded.indexOf(':');
  const providedUser = idx >= 0 ? decoded.slice(0, idx) : '';
  const providedPass = idx >= 0 ? decoded.slice(idx + 1) : '';

  if (!safeEqual(providedUser, user) || !safeEqual(providedPass, password)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MyWallet Docs", charset="UTF-8"');
    res.status(401).send('Invalid credentials');
    return;
  }

  next();
}
