import { Schema, model, Document, Types } from 'mongoose';

export type TenantMembershipRole = 'member';
export type TenantMembershipStatus = 'active' | 'pending';

/**
 * A TenantMembership grants `userId` access to the wallet owned by
 * `tenantId`'s primary user, decoupled from `User.tenantId` (which always
 * points at the user's own wallet). Members are read-only; the owner is
 * implicit via `Tenant.primaryUserId` and never has a membership row in
 * their own tenant. `status` is always `active` for now — `pending` is
 * reserved for the future email-accept invitation flow.
 */
export interface TenantMembershipInterface extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  role: TenantMembershipRole;
  status: TenantMembershipStatus;
  invitedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TenantMembershipSchema = new Schema<TenantMembershipInterface>({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['member'], default: 'member', required: true },
  status: { type: String, enum: ['active', 'pending'], default: 'active', required: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  collection: 'tenant_memberships',
});

TenantMembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export const TenantMembership = model<TenantMembershipInterface>('TenantMembership', TenantMembershipSchema);
