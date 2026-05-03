import type { Request } from 'express';

/**
 * Request-scoped representation of the authenticated principal. `id` is the
 * canonical internal user identifier (User._id) — never the auth-provider
 * UID. `authUid` is kept for traceability and provider-specific actions.
 */
export interface AuthUser {
  id: string;
  authUid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
}

export interface FirebaseCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Profile claims extracted from a verified auth credential. Fed to the
 * UserResolverInterface to upsert the matching internal User record.
 */
export interface UserProfile {
  authUid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
}

/**
 * Resolves an external auth identity to the internal User record,
 * provisioning one on first sight (idempotent upsert). All call sites that
 * need the canonical userId go through this contract.
 */
export interface UserResolverInterface {
  resolve(profile: UserProfile): Promise<AuthUser>;
  invalidate(authUid: string): void;
}

/**
 * Strategy contract for resolving an authenticated user from an incoming
 * request. Implementations decide which credential to look at (Bearer token,
 * dev header, future API key, etc.) and how to validate it.
 */
export interface AuthVerifierInterface {
  verify(req: Request): Promise<AuthUser>;
}

/**
 * Idempotently ensures a tenant record exists for a freshly resolved user.
 * Invoked from the user resolver so any authenticated request can assume
 * its Tenant row is already there.
 */
export interface TenantProvisionerInterface {
  ensureForUser(user: AuthUser): Promise<void>;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
