import { Types } from 'mongoose';
import { Tenant, User, type TenantInterface } from '../../../temporal-workflows/src/models';
import type {
  AddMemberInput,
  TenantDTO,
  TenantMemberDTO,
  TenantShape,
  UpdateTenantInput,
  UserShape,
} from '../types/tenant.types';
import {
  CannotRemovePrimaryError,
  MemberNotFoundError,
  NotPrimaryUserError,
} from '../types/errors';

export class TenantService {
  /** Tenant the authed user currently belongs to (incl. members). */
  async getForUser(authedUserId: string): Promise<TenantDTO | null> {
    const user = await User.findById(authedUserId).lean();
    if (!user?.tenantId) return null;

    const tenant = await Tenant.findById(user.tenantId).lean();
    if (!tenant) return null;

    const members = await this.listMembers(tenant);
    return toDTO(tenant, members);
  }

  async update(authedUserId: string, input: UpdateTenantInput): Promise<TenantDTO | null> {
    const user = await User.findById(authedUserId).lean();
    if (!user?.tenantId) return null;

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.type !== undefined) updates.type = input.type;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.budgetLimit !== undefined) updates.budgetLimit = input.budgetLimit;
    if (input.notificationsEnabled !== undefined) updates.notificationsEnabled = input.notificationsEnabled;
    if (input.emailSyncEnabled !== undefined) updates.emailSyncEnabled = input.emailSyncEnabled;

    const tenant = await Tenant.findByIdAndUpdate(user.tenantId, { $set: updates }, { new: true }).lean();
    if (!tenant) return null;

    const members = await this.listMembers(tenant);
    return toDTO(tenant, members);
  }

  /**
   * Adds an existing user (looked up by email) as a member of the
   * authed-user's tenant. Only the tenant's primary user can do this —
   * anyone else gets `NotPrimaryUserError`. Idempotent: re-adding an
   * existing member is a no-op.
   */
  async addMember(authedUserId: string, input: AddMemberInput): Promise<TenantMemberDTO> {
    const tenant = await this.requirePrimary(authedUserId);

    const newMember = await User.findOne({ email: input.email.toLowerCase().trim() });
    if (!newMember) throw new MemberNotFoundError(`No user with email ${input.email}`);

    if (String(newMember.tenantId) !== String(tenant._id)) {
      newMember.tenantId = tenant._id;
      await newMember.save();
    }

    return memberToDTO(newMember, tenant.primaryUserId);
  }

  async listMembersForUser(authedUserId: string): Promise<TenantMemberDTO[]> {
    const user = await User.findById(authedUserId).lean();
    if (!user?.tenantId) return [];
    const tenant = await Tenant.findById(user.tenantId).lean();
    if (!tenant) return [];
    return this.listMembers(tenant);
  }

  /**
   * Removes a member from the authed-user's tenant. Only the primary
   * user can remove members; the primary cannot remove themselves.
   * Removed members are detached (their `tenantId` is unset) so a fresh
   * tenant will be provisioned for them on next sign-in.
   */
  async removeMember(authedUserId: string, memberUserId: string): Promise<void> {
    const tenant = await this.requirePrimary(authedUserId);

    if (String(tenant.primaryUserId) === memberUserId) {
      throw new CannotRemovePrimaryError('The primary user cannot be removed from their own tenant');
    }

    const result = await User.updateOne(
      { _id: memberUserId, tenantId: tenant._id },
      { $unset: { tenantId: '' } },
    );
    if (result.matchedCount === 0) {
      throw new MemberNotFoundError(`User ${memberUserId} is not a member of this tenant`);
    }
  }

  private async requirePrimary(authedUserId: string): Promise<TenantInterface> {
    const user = await User.findById(authedUserId).lean();
    if (!user?.tenantId) throw new NotPrimaryUserError('Authed user has no tenant');

    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant) throw new NotPrimaryUserError('Authed user has no tenant');

    if (String(tenant.primaryUserId) !== authedUserId) {
      throw new NotPrimaryUserError('Only the tenant primary user can perform this action');
    }
    return tenant;
  }

  private async listMembers(tenant: TenantShape): Promise<TenantMemberDTO[]> {
    const members = await User.find({ tenantId: tenant._id }).lean();
    return members.map((m) => memberToDTO(m, tenant.primaryUserId));
  }
}

function toDTO(tenant: TenantShape, members: TenantMemberDTO[]): TenantDTO {
  return {
    id: String(tenant._id),
    type: tenant.type,
    name: tenant.name,
    primaryUserId: String(tenant.primaryUserId),
    currency: tenant.currency ?? 'USD',
    budgetLimit: tenant.budgetLimit ?? 0,
    notificationsEnabled: tenant.notificationsEnabled ?? true,
    emailSyncEnabled: tenant.emailSyncEnabled ?? false,
    members,
  };
}

function memberToDTO(user: UserShape, primaryUserId: Types.ObjectId): TenantMemberDTO {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    isPrimary: String(user._id) === String(primaryUserId),
  };
}
