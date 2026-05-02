import admin from 'firebase-admin';
import type { Request } from 'express';
import type { AuthUser, FirebaseCredentials, IAuthVerifier } from './types';
import { UnauthorizedError } from './errors';
import { logger } from '../utils/logger';

const BEARER_PREFIX = 'Bearer ';

export class FirebaseAuthVerifier implements IAuthVerifier {
  private readonly app: admin.app.App;

  constructor(credentials: FirebaseCredentials) {
    if (!credentials.projectId || !credentials.clientEmail || !credentials.privateKey) {
      throw new Error(
        'Firebase Admin credentials missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (or enable AUTH_BYPASS=true for local dev).'
      );
    }

    this.app = admin.initializeApp({
      credential: admin.credential.cert(credentials),
    });
    logger.info('Firebase Admin initialized', { projectId: credentials.projectId });
  }

  async verify(req: Request): Promise<AuthUser> {
    const token = this.extractBearerToken(req.headers.authorization);
    try {
      const decoded = await this.app.auth().verifyIdToken(token);
      return {
        id: decoded.uid,
        email: decoded.email,
        name: decoded.name,
        emailVerified: decoded.email_verified,
      };
    } catch (err: any) {
      logger.warn('Firebase token verification failed', {
        code: err?.code,
        message: err?.message,
      });
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  private extractBearerToken(header?: string): string {
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError('Missing Bearer token');
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) throw new UnauthorizedError('Empty Bearer token');
    return token;
  }
}
