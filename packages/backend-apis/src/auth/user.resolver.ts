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

/**
 * Mongo-backed UserResolverInterface. Idempotent first-login provisioning via upsert,
 * with a small in-process TTL cache so we don't hit the database on every
 * authenticated request. When a tenantProvisioner is supplied, ensures the
 * user's Tenant row exists alongside the User record.
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
    const cached = this.cache.get(profile.authUid);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const doc = await this.upsert(profile);
    const user = this.toAuthUser(doc);
    if (this.tenantProvisioner) await this.tenantProvisioner.ensureForUser(user);
    this.cache.set(profile.authUid, { user, expiresAt: Date.now() + this.ttlMs });
    return user;
  }

  invalidate(authUid: string): void {
    this.cache.delete(authUid);
  }

  private async upsert(profile: UserProfile): Promise<UserInterface> {
    const set: Partial<UserInterface> = { lastLoginAt: new Date() };
    if (profile.email) set.email = profile.email;
    if (profile.displayName) set.displayName = profile.displayName;
    if (profile.emailVerified !== undefined) set.emailVerified = profile.emailVerified;

    const doc = await User.findOneAndUpdate(
      { authUid: profile.authUid },
      {
        $setOnInsert: { authUid: profile.authUid },
        $set: set,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!doc) throw new Error(`User upsert failed for authUid=${profile.authUid}`);
    return doc;
  }

  private toAuthUser(doc: UserInterface): AuthUser {
    return {
      id: String(doc._id),
      authUid: doc.authUid,
      email: doc.email,
      displayName: doc.displayName,
      emailVerified: doc.emailVerified,
    };
  }
}

/**
 * Convenience helper for code paths outside the auth middleware that need
 * to translate an auth-provider UID into the internal user id.
 */
export async function resolveUserId(
  resolver: UserResolverInterface,
  profile: UserProfile,
): Promise<string> {
  const user = await resolver.resolve(profile);
  return user.id;
}
