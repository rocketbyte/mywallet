import { Tenant, User } from '../../../temporal-workflows/src/models';
import type { AuthUser, TenantProvisionerInterface } from './types';
import { logger } from '../utils/logger';

/**
 * Mongo-backed tenant provisioner. On first sight of a user, creates a
 * Tenant with that user as the `primaryUserId` and links the user back
 * via `User.tenantId`. Idempotent: if the user already has a tenant we
 * leave it alone.
 *
 * Mutates the supplied `AuthUser` in-place to populate `tenantId` and
 * `dataOwnerId`, so the request handler can scope queries without
 * re-reading the database.
 */
export class MongoTenantProvisioner implements TenantProvisionerInterface {
  async ensureForUser(user: AuthUser): Promise<void> {
    const userDoc = await User.findById(user.id);
    if (!userDoc) {
      logger.warn('Tenant provision skipped — user document missing', { userId: user.id });
      return;
    }

    if (userDoc.tenantId) {
      const tenant = await Tenant.findById(userDoc.tenantId).lean();
      if (tenant) {
        user.tenantId = String(tenant._id);
        user.dataOwnerId = String(tenant.primaryUserId);
        return;
      }
      // Stale pointer — fall through and re-provision.
      logger.warn('User.tenantId points at a missing tenant — recreating', { userId: user.id });
    }

    // Race-safe: another concurrent request may have provisioned the
    // tenant between our findById and now. The unique index on
    // primaryUserId guarantees we only ever end up with one row, and
    // findOneAndUpdate(upsert) returns whichever side won.
    const tenant = await Tenant.findOneAndUpdate(
      { primaryUserId: userDoc._id },
      {
        $setOnInsert: {
          primaryUserId: userDoc._id,
          type: 'individual',
          name: user.displayName,
          currency: 'USD',
          budgetLimit: 0,
          notificationsEnabled: true,
          emailSyncEnabled: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (!tenant) throw new Error(`Tenant upsert failed for userId=${user.id}`);

    if (String(userDoc.tenantId) !== String(tenant._id)) {
      await User.updateOne({ _id: userDoc._id }, { $set: { tenantId: tenant._id } });
    }

    user.tenantId = String(tenant._id);
    user.dataOwnerId = String(tenant.primaryUserId);
  }
}
