import { Tenant } from '../../../temporal-workflows/src/models';
import type { AuthUser, TenantProvisionerInterface } from './types';
import { logger } from '../utils/logger';

/**
 * Mongo-backed tenant provisioner. Creates a default Tenant row keyed on the
 * internal user id when one is missing; never overwrites existing config.
 */
export class MongoTenantProvisioner implements TenantProvisionerInterface {
  async ensureForUser(user: AuthUser): Promise<void> {
    if (!user.email) {
      logger.warn('Skipping tenant provision — user has no email', { userId: user.id });
      return;
    }
    await Tenant.findOneAndUpdate(
      { userId: user.id },
      {
        $setOnInsert: {
          userId: user.id,
          email: user.email,
          fullName: user.displayName,
          currency: 'USD',
          budgetLimit: 0,
          notificationsEnabled: true,
          emailSyncEnabled: false,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
}
