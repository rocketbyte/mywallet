import type { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

const BEARER_PREFIX = 'Bearer ';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

// Single shared client; verifyIdToken fetches and caches Google's signing certs.
const oauthClient = new OAuth2Client();

function extractBearer(header?: string): string | null {
  if (!header || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token || null;
}

/**
 * Verifies the Google-signed OIDC token that Pub/Sub push attaches to webhook
 * requests, before the handler runs. Asserts the token's issuer is Google, its
 * audience matches PUBSUB_VERIFICATION_AUDIENCE, and — when configured — that it
 * was minted by PUBSUB_SERVICE_ACCOUNT_EMAIL.
 *
 * Verification is opt-in: when no audience is configured this middleware is a
 * no-op, so local/dev (and any not-yet-configured) setup keeps working. Boot
 * logs a warning in production when it is unset (see config). The moment an
 * audience is configured, verification is enforced here.
 */
export async function requirePubSubOIDC(req: Request, res: Response, next: NextFunction): Promise<void> {
  const audience = config.pubsub.verificationAudience;
  if (!audience) {
    return next();
  }

  const token = extractBearer(req.headers.authorization);
  if (!token) {
    logger.warn('Rejected Pub/Sub webhook: missing OIDC bearer token');
    res.status(401).json({ error: 'Unauthorized', message: 'Missing Pub/Sub OIDC token' });
    return;
  }

  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();

    if (!payload || !payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
      throw new Error(`unexpected issuer: ${payload?.iss}`);
    }

    const expectedEmail = config.pubsub.serviceAccountEmail;
    if (expectedEmail && (payload.email !== expectedEmail || payload.email_verified !== true)) {
      throw new Error(`unexpected service account: ${payload.email}`);
    }

    next();
  } catch (err) {
    logger.warn('Rejected Pub/Sub webhook: OIDC verification failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid Pub/Sub OIDC token' });
  }
}
