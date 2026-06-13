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
    // Provisioner mutates `user` to attach tenantId + dataOwnerId so
    // request handlers can scope queries without an extra DB round-trip.
    if (this.tenantProvisioner) await this.tenantProvisioner.ensureForUser(user);
    this.cache.set(key, { user, expiresAt: Date.now() + this.ttlMs });
    return user;
  }

  invalidate(provider: string, subject: string): void {
    this.cache.delete(cacheKey(provider, subject));
  }

  private async upsert(profile: UserProfile): Promise<UserInterface> {
    const normalizedEmail = profile.email ? normalizeEmail(profile.email) : undefined;

    const set: Partial<UserInterface> = { lastLoginAt: new Date() };
    if (normalizedEmail) set.email = normalizedEmail;
    if (profile.displayName) set.displayName = profile.displayName;
    if (profile.emailVerified !== undefined) set.emailVerified = profile.emailVerified;

    // Step 1: resolve an EXISTING user for this login, in priority order:
    //   (a) this exact IDP identity (an identities[] entry, or the legacy
    //       `authUid` mirror) — a returning user, possibly via a linked UID;
    //   (b) only if none, AND the IDP asserts a VERIFIED email, by that
    //       email — so a second IDP identity for the same person links to
    //       their existing account instead of forking a duplicate user +
    //       tenant. An unverified email is never allowed to attach to an
    //       existing account (account-takeover guard).
    let doc = await User.findOne({
      $or: [
        { identities: { $elemMatch: { provider: profile.provider, subject: profile.subject } } },
        { authUid: profile.subject },
      ],
    });

    if (!doc && normalizedEmail && profile.emailVerified) {
      doc = await User.findOne({ email: normalizedEmail });
    }

    if (doc) {
      // Returning or newly-linked user — refresh best-effort profile fields.
      await User.updateOne({ _id: doc._id }, { $set: set });
      Object.assign(doc, set);
    } else {
      // Brand-new person: create keyed on the legacy `authUid` unique index.
      const created = await User.findOneAndUpdate(
        { authUid: profile.subject },
        { $set: set, $setOnInsert: { authUid: profile.subject } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (!created) throw new Error(`User upsert failed for subject=${profile.subject}`);
      doc = created;
    }

    // Step 2: ensure the (provider, subject) pair is recorded in
    // identities[]. The filter + $push runs atomically in Mongo, so two
    // concurrent first-login requests can't both pass the "not present"
    // check and double-push. modifiedCount tells us whether we actually
    // appended, so the in-memory copy stays consistent with the DB.
    const identity = { provider: profile.provider, subject: profile.subject, linkedAt: new Date() };
    const res = await User.updateOne(
      {
        _id: doc._id,
        identities: { $not: { $elemMatch: { provider: profile.provider, subject: profile.subject } } },
      },
      { $push: { identities: identity } },
    );
    if (res.modifiedCount > 0) {
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
 * Canonical form for email matching: trimmed and lower-cased. Used both when
 * storing `User.email` and when looking a user up by email so identity linking
 * and membership invites compare on the same key.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
