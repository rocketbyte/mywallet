import { Schema, model, Document, Types } from 'mongoose';

export type TenantType = 'individual' | 'business';

/**
 * A Tenant is the data-ownership boundary in the system. One Tenant has
 * exactly one `primaryUserId` (the user whose data the tenant holds);
 * additional members — Users with `tenantId` pointing at this tenant —
 * see the primary user's data through the data-owner resolver.
 */
export interface TenantInterface extends Document {
  _id: Types.ObjectId;
  primaryUserId: Types.ObjectId;
  type: TenantType;
  name?: string;
  currency?: string;
  budgetLimit?: number;
  notificationsEnabled?: boolean;
  emailSyncEnabled?: boolean;
  /** When false, members see masked budget values (balances and progress only). */
  showBudgetToMembers?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<TenantInterface>({
  primaryUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  type: { type: String, enum: ['individual', 'business'], default: 'individual', required: true },
  name: { type: String },
  currency: { type: String, default: 'USD' },
  budgetLimit: { type: Number, default: 0 },
  notificationsEnabled: { type: Boolean, default: true },
  emailSyncEnabled: { type: Boolean, default: false },
  showBudgetToMembers: { type: Boolean, default: true },
}, {
  timestamps: true,
  collection: 'tenants',
});

export const Tenant = model<TenantInterface>('Tenant', TenantSchema);
