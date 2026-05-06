import type { Request } from 'express';
import type { AuthUser, AuthVerifierInterface, UserResolverInterface, UserProfile } from './types';
import { UnauthorizedError } from './errors';
import { logger } from '../utils/logger';

const HEADER_USER_ID = 'x-user-id';
const HEADER_USER_EMAIL = 'x-user-email';
const FALLBACK_EMAIL_DOMAIN = 'bypass.local';

/**
 * Dev-only verifier that trusts an x-user-id header. Activated via
 * AUTH_BYPASS=true. Never enable in production — requests are not authenticated.
 */
export class BypassAuthVerifier implements AuthVerifierInterface {
  constructor(private readonly userResolver: UserResolverInterface) {
    logger.warn('BypassAuthVerifier active — AUTH_BYPASS is enabled');
  }

  async verify(req: Request): Promise<AuthUser> {
    const subject = this.firstHeaderValue(req.headers[HEADER_USER_ID]);
    if (!subject) {
      throw new UnauthorizedError(`AUTH_BYPASS enabled but ${HEADER_USER_ID} header missing`);
    }

    const profile: UserProfile = {
      provider: 'bypass',
      subject,
      email: this.firstHeaderValue(req.headers[HEADER_USER_EMAIL]) ?? `${subject}@${FALLBACK_EMAIL_DOMAIN}`,
    };
    return this.userResolver.resolve(profile);
  }

  private firstHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
  }
}
