import { User, type UserInterface } from '../../../temporal-workflows/src/models';
import type {
  AuthUser,
  TenantProvisionerInterface,
  UserResolverInterface,
  UserProfile,
} from './types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface MongoUserResolverOptions {
  ttlMs?: number;
  tenantProvisioner?: TenantProvisionerInterface;
}

const cacheKey = (provider: string, subject: string) => `${provider}:${subject}`;

/**
 * Mongo-backed UserResolverInterface. Idempotent first-login provisioning
 * via upsert, with a small in-process TTL cache so we don't hit the
 * database on every authenticated request. When a tenantProvisioner is
 * supplied, ensures the user's Tenant row exists alongside the User
 * record. The (provider, subject) identity is recorded in
 * `User.identities[]` so additional IDPs can be linked to the same user
 * without schema changes.
 */
export class MongoUserResolver implements UserResolverInterface {
  private readonly cache = new Map<string, { user: AuthUser; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly tenantProvisioner?: TenantProvisionerInterface;

  constructor(opts: MongoUserResolverOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.tenantProvisioner = opts.tenantProvisioner;
  }

  async resolve(profile: UserProfile): Promise<AuthUser> {
    const key = cacheKey(profile.provider, profile.subject);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const doc = await this.upsert(profile);
    const user = this.toAuthUser(doc, profile.provider);
    if (this.tenantProvisioner) await this.tenantProvisioner.ensureForUser(user);
    this.cache.set(key, { user, expiresAt: Date.now() + this.ttlMs });
    return user;
  }

  invalidate(provider: string, subject: string): void {
    this.cache.delete(cacheKey(provider, subject));
  }

  private async upsert(profile: UserProfile): Promise<UserInterface> {
    const set: Partial<UserInterface> = { lastLoginAt: new Date() };
    if (profile.email) set.email = profile.email;
    if (profile.displayName) set.displayName = profile.displayName;
    if (profile.emailVerified !== undefined) set.emailVerified = profile.emailVerified;

    // Step 1: atomic upsert keyed on the legacy unique index. For the
    // primary IDP, `authUid` mirrors the OIDC subject — this single op
    // covers both new-user provisioning and returning-user updates.
    const doc = await User.findOneAndUpdate(
      { authUid: profile.subject },
      { $set: set, $setOnInsert: { authUid: profile.subject } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!doc) throw new Error(`User upsert failed for subject=${profile.subject}`);

    // Step 2: ensure the (provider, subject) pair is recorded in
    // identities[]. Idempotent — only pushes when not already present.
    const hasIdentity = doc.identities?.some(
      (i) => i.provider === profile.provider && i.subject === profile.subject
    );
    if (!hasIdentity) {
      const identity = { provider: profile.provider, subject: profile.subject, linkedAt: new Date() };
      await User.updateOne({ _id: doc._id }, { $push: { identities: identity } });
      doc.identities = [...(doc.identities ?? []), identity];
    }

    return doc;
  }

  private toAuthUser(doc: UserInterface, provider: string): AuthUser {
    return {
      id: String(doc._id),
      authUid: doc.authUid,
      provider,
      email: doc.email,
      displayName: doc.displayName,
      emailVerified: doc.emailVerified,
    };
  }
}

/**
 * Convenience helper for code paths outside the auth middleware that need
 * to translate an external identity into the internal user id.
 */
export async function resolveUserId(
  resolver: UserResolverInterface,
  profile: UserProfile,
): Promise<string> {
  const user = await resolver.resolve(profile);
  return user.id;
}
