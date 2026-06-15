import { Types } from 'mongoose';
import {
  Tenant,
  TenantMembership,
  User,
  type TenantInterface,
} from '../../../temporal-workflows/src/models';
import type {
  AddMemberInput,
  TenantDTO,
  TenantMemberDTO,
  TenantShape,
  UpdateTenantInput,
  UserShape,
  WalletDTO,
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
    return this.getByTenantId(String(user.tenantId));
  }

  /** Tenant by id — used when the acting wallet differs from the caller's own. */
  async getByTenantId(tenantId: string): Promise<TenantDTO | null> {
    const tenant = await Tenant.findById(tenantId).lean();
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
    if (input.showBudgetToMembers !== undefined) updates.showBudgetToMembers = input.showBudgetToMembers;

    const tenant = await Tenant.findByIdAndUpdate(user.tenantId, { $set: updates }, { new: true }).lean();
    if (!tenant) return null;

    const members = await this.listMembers(tenant);
    return toDTO(tenant, members);
  }

  /**
   * Adds an existing user (looked up by email) as a read-only member of the
   * authed-user's tenant via a TenantMembership record. The member's own
   * `User.tenantId` (their home wallet) is never touched. Only the tenant's
   * primary user can invite. Idempotent: re-adding upserts the same row.
   */
  async addMember(authedUserId: string, input: AddMemberInput): Promise<TenantMemberDTO> {
    const tenant = await this.requirePrimary(authedUserId);

    const newMember = await User.findOne({ email: input.email.toLowerCase().trim() }).lean();
    if (!newMember) throw new MemberNotFoundError(`No user with email ${input.email}`);

    if (String(newMember._id) === String(tenant.primaryUserId)) {
      throw new CannotRemovePrimaryError('The owner is already part of their own wallet');
    }

    const membership = await TenantMembership.findOneAndUpdate(
      { tenantId: tenant._id, userId: newMember._id },
      {
        $setOnInsert: {
          tenantId: tenant._id,
          userId: newMember._id,
          role: 'member',
          status: 'active',
          invitedBy: new Types.ObjectId(authedUserId),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    return memberToDTO(newMember, 'member', membership?.createdAt);
  }

  async listMembersForUser(authedUserId: string): Promise<TenantMemberDTO[]> {
    const user = await User.findById(authedUserId).lean();
    if (!user?.tenantId) return [];
    const tenant = await Tenant.findById(user.tenantId).lean();
    if (!tenant) return [];
    return this.listMembers(tenant);
  }

  /**
   * Removes a member by deleting their membership record. The member's own
   * wallet and data are unaffected. Only the primary user can remove;
   * the primary themselves has no membership row and cannot be removed.
   */
  async removeMember(authedUserId: string, memberUserId: string): Promise<void> {
    const tenant = await this.requirePrimary(authedUserId);

    if (String(tenant.primaryUserId) === memberUserId) {
      throw new CannotRemovePrimaryError('The primary user cannot be removed from their own tenant');
    }

    const result = await TenantMembership.deleteOne({ tenantId: tenant._id, userId: memberUserId });
    if (result.deletedCount === 0) {
      throw new MemberNotFoundError(`User ${memberUserId} is not a member of this tenant`);
    }
  }

  /**
   * Every wallet the user can act in: their own first, then one entry per
   * active membership. `budgetHidden` is only meaningful on member entries.
   */
  async listWalletsForUser(authedUserId: string): Promise<WalletDTO[]> {
    const user = await User.findById(authedUserId).lean();
    if (!user) return [];

    const wallets: WalletDTO[] = [];

    if (user.tenantId) {
      const own = await Tenant.findById(user.tenantId).lean();
      if (own) {
        wallets.push({
          id: String(own._id),
          name: own.name,
          ownerName: user.displayName ?? user.email,
          role: 'owner',
          budgetHidden: false,
        });
      }
    }

    const memberships = await TenantMembership.find({ userId: authedUserId, status: 'active' }).lean();
    if (memberships.length === 0) return wallets;

    const tenants = await Tenant.find({ _id: { $in: memberships.map((m) => m.tenantId) } }).lean();
    const owners = await User.find({ _id: { $in: tenants.map((t) => t.primaryUserId) } }).lean();
    const ownersById = new Map(owners.map((o) => [String(o._id), o]));

    for (const tenant of tenants) {
      const owner = ownersById.get(String(tenant.primaryUserId));
      wallets.push({
        id: String(tenant._id),
        name: tenant.name,
        ownerName: owner?.displayName ?? owner?.email,
        role: 'member',
        budgetHidden: tenant.showBudgetToMembers === false,
      });
    }

    return wallets;
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
    const owner = await User.findById(tenant.primaryUserId).lean();
    const memberships = await TenantMembership.find({ tenantId: tenant._id, status: 'active' }).lean();
    const users = memberships.length
      ? await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean()
      : [];
    const joinedAtByUser = new Map<string, Date | undefined>(
      memberships.map((m) => [String(m.userId), m.createdAt]),
    );

    const rows: TenantMemberDTO[] = [];
    if (owner) rows.push(memberToDTO(owner, 'owner'));
    for (const u of users) rows.push(memberToDTO(u, 'member', joinedAtByUser.get(String(u._id))));
    return rows;
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
    showBudgetToMembers: tenant.showBudgetToMembers !== false,
    members,
  };
}

function memberToDTO(user: UserShape, role: 'owner' | 'member', joinedAt?: Date): TenantMemberDTO {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    role,
    joinedAt: joinedAt?.toISOString(),
    isPrimary: role === 'owner',
  };
}
