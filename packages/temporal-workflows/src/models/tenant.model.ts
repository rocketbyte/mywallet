import { Schema, model, Document } from 'mongoose';

export interface ITenant extends Document {
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

const TenantSchema = new Schema<ITenant>({
  userId: { type: String, unique: true, index: true },
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

export const Tenant = model<ITenant>('Tenant', TenantSchema);
