import type { Request } from 'express';
import type { AuthUser, IAuthVerifier } from './types';
import { UnauthorizedError } from './errors';
import { logger } from '../utils/logger';

const HEADER_USER_ID = 'x-user-id';
const HEADER_USER_EMAIL = 'x-user-email';

/**
 * Dev-only verifier that trusts an x-user-id header. Activated via
 * AUTH_BYPASS=true. Never enable in production — requests are not authenticated.
 */
export class BypassAuthVerifier implements IAuthVerifier {
  constructor() {
    logger.warn('BypassAuthVerifier active — AUTH_BYPASS is enabled');
  }

  async verify(req: Request): Promise<AuthUser> {
    const id = this.firstHeaderValue(req.headers[HEADER_USER_ID]);
    if (!id) {
      throw new UnauthorizedError(`AUTH_BYPASS enabled but ${HEADER_USER_ID} header missing`);
    }
    return {
      id,
      email: this.firstHeaderValue(req.headers[HEADER_USER_EMAIL]),
    };
  }

  private firstHeaderValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
  }
}
