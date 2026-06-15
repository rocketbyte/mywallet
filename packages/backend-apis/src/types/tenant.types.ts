import type { TenantInterface, UserInterface } from '../../../temporal-workflows/src/models';

export type TenantType = 'individual' | 'business';

export type TenantShape = Pick<
  TenantInterface,
  '_id' | 'primaryUserId' | 'type' | 'name' | 'currency' | 'budgetLimit' | 'notificationsEnabled' | 'emailSyncEnabled' | 'showBudgetToMembers'
>;

export type UserShape = Pick<UserInterface, '_id' | 'email' | 'displayName'>;

export interface TenantMemberDTO {
  id: string;
  email: string;
  displayName?: string;
  role: 'owner' | 'member';
  joinedAt?: string;
  /** @deprecated use role === 'owner' */
  isPrimary: boolean;
}

export interface TenantDTO {
  id: string;
  type: TenantType;
  name?: string;
  primaryUserId: string;
  currency: string;
  /** Null when budget values are hidden from the requesting member. */
  budgetLimit: number | null;
  notificationsEnabled: boolean;
  emailSyncEnabled: boolean;
  showBudgetToMembers: boolean;
  members: TenantMemberDTO[];
}

export interface UpdateTenantInput {
  name?: string;
  type?: TenantType;
  currency?: string;
  budgetLimit?: number;
  notificationsEnabled?: boolean;
  emailSyncEnabled?: boolean;
  showBudgetToMembers?: boolean;
}

export interface AddMemberInput {
  email: string;
}

/** One wallet the caller can act in — own wallet or an active membership. */
export interface WalletDTO {
  id: string;
  name?: string;
  ownerName?: string;
  role: 'owner' | 'member';
  budgetHidden: boolean;
}
