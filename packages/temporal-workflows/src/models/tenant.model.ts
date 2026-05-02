import { Schema, model, Document } from 'mongoose';

export interface TenantInterface extends Document {
  userId: string;
  email?: string;
  fullName?: string;
  currency?: string;
  budgetLimit?: number;
  notificationsEnabled?: boolean;
  emailSyncEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<TenantInterface>({
  userId: { type: String, required: true, unique: true, index: true },
  email: { type: String },
  fullName: { type: String },
  currency: { type: String, default: 'USD' },
  budgetLimit: { type: Number, default: 0 },
  notificationsEnabled: { type: Boolean, default: true },
  emailSyncEnabled: { type: Boolean, default: false },
}, {
  timestamps: true,
  collection: 'tenants',
});

export const Tenant = model<TenantInterface>('Tenant', TenantSchema);
