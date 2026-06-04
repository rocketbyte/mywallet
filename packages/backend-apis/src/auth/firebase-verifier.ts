import admin from 'firebase-admin';
import type { Request } from 'express';
import type { AuthUser, FirebaseCredentials, AuthVerifierInterface, UserResolverInterface, UserProfile } from './types';
import { UnauthorizedError } from './errors';
import { logger } from '../utils/logger';

const BEARER_PREFIX = 'Bearer ';

export class FirebaseAuthVerifier implements AuthVerifierInterface {
  private readonly app: admin.app.App;

  constructor(
    credentials: FirebaseCredentials,
    private readonly userResolver: UserResolverInterface,
  ) {
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
    const decoded = await this.verifyToken(token);

    const profile: UserProfile = {
      provider: 'firebase',
      subject: decoded.uid,
      email: decoded.email,
      displayName: decoded.name,
      emailVerified: decoded.email_verified,
    };
    return this.userResolver.resolve(profile);
  }

  private async verifyToken(token: string): Promise<admin.auth.DecodedIdToken> {
    try {
      return await this.app.auth().verifyIdToken(token);
    } catch (err: any) {
      logger.warn('Token verification failed', {
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
