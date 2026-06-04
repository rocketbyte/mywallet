import type { RequestHandler } from 'express';
import type { AuthVerifierInterface } from './types';
import { UnauthorizedError } from './errors';
import { logger } from '../utils/logger';

const WWW_AUTH_REALM = 'Bearer realm="MyWallet API"';

export function requireAuth(verifier: AuthVerifierInterface): RequestHandler {
  return async (req, res, next) => {
    try {
      req.user = await verifier.verify(req);
      next();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        res.setHeader('WWW-Authenticate', WWW_AUTH_REALM);
        res.status(401).json({ error: 'Unauthorized', message: err.message });
        return;
      }
      logger.error('Auth verification threw a non-Unauthorized error', {
        path: req.path,
        method: req.method,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.setHeader('WWW-Authenticate', WWW_AUTH_REALM);
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication failed' });
    }
  };
}
