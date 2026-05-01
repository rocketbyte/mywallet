import { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../config/firebase';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

function unauthorized(res: Response, message: string) {
  res.setHeader('WWW-Authenticate', 'Bearer realm="MyWallet API"');
  res.status(401).json({ error: 'Unauthorized', message });
}

export async function firebaseAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Dev-only bypass: trust x-user-id when explicitly enabled.
  if (config.firebase.authBypass) {
    const headerUserId = req.headers['x-user-id'];
    const userId = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;
    if (!userId) {
      return unauthorized(res, 'AUTH_BYPASS enabled but x-user-id header missing');
    }
    req.user = {
      id: userId,
      email: (req.headers['x-user-email'] as string) || undefined,
    };
    return next();
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return unauthorized(res, 'Missing Bearer token');
  }

  const idToken = header.slice(7).trim();
  if (!idToken) {
    return unauthorized(res, 'Empty Bearer token');
  }

  try {
    const decoded = await firebaseAuth().verifyIdToken(idToken);
    req.user = {
      id: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      emailVerified: decoded.email_verified,
    };
    next();
  } catch (err: any) {
    logger.warn('Firebase token verification failed', {
      code: err?.code,
      message: err?.message,
    });
    return unauthorized(res, 'Invalid or expired token');
  }
}
