import type { RequestHandler } from 'express';
import type { IAuthVerifier } from './types';
import { UnauthorizedError } from './errors';

const WWW_AUTH_REALM = 'Bearer realm="MyWallet API"';

export function requireAuth(verifier: IAuthVerifier): RequestHandler {
  return async (req, res, next) => {
    try {
      req.user = await verifier.verify(req);
      next();
    } catch (err) {
      const message = err instanceof UnauthorizedError ? err.message : 'Authentication failed';
      res.setHeader('WWW-Authenticate', WWW_AUTH_REALM);
      res.status(401).json({ error: 'Unauthorized', message });
    }
  };
}
