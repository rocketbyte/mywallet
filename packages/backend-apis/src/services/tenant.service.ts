import { Tenant } from '../../../temporal-workflows/src/models';

export interface TenantDTO {
  id: string;
  email: string;
  full_name?: string;
  currency: string;
  budget_limit: number;
  notifications_enabled: boolean;
  email_sync_enabled: boolean;
}

export interface UpsertTenantInput {
  email: string;
  full_name?: string;
  currency?: string;
  budget_limit?: number;
  notifications_enabled?: boolean;
  email_sync_enabled?: boolean;
}

function toDTO(doc: any): TenantDTO {
  return {
    id: doc.userId,
    email: doc.email,
    full_name: doc.fullName,
    currency: doc.currency,
    budget_limit: doc.budgetLimit,
    notifications_enabled: doc.notificationsEnabled,
    email_sync_enabled: doc.emailSyncEnabled,
  };
}

export class TenantService {
  async get(userId: string): Promise<TenantDTO | null> {
    const doc = await Tenant.findOne({ userId }).lean();
    return doc ? toDTO(doc) : null;
  }

  async upsert(userId: string, input: UpsertTenantInput): Promise<TenantDTO> {
    const doc = await Tenant.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          email: input.email,
          fullName: input.full_name,
          currency: input.currency ?? 'USD',
          budgetLimit: input.budget_limit ?? 0,
          notificationsEnabled: input.notifications_enabled ?? true,
          emailSyncEnabled: input.email_sync_enabled ?? false,
        },
      },
      { upsert: true, new: true }
    ).lean();
    return toDTO(doc);
  }

  async update(userId: string, input: Partial<UpsertTenantInput>): Promise<TenantDTO | null> {
    const updates: Record<string, any> = {};
    if (input.full_name !== undefined) updates.fullName = input.full_name;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.budget_limit !== undefined) updates.budgetLimit = input.budget_limit;
    if (input.notifications_enabled !== undefined) updates.notificationsEnabled = input.notifications_enabled;
    if (input.email_sync_enabled !== undefined) updates.emailSyncEnabled = input.email_sync_enabled;

    const doc = await Tenant.findOneAndUpdate({ userId }, { $set: updates }, { new: true }).lean();
    return doc ? toDTO(doc) : null;
  }
}
