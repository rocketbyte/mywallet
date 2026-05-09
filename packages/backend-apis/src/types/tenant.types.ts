import type { TenantInterface, UserInterface } from '../../../temporal-workflows/src/models';

export type TenantType = 'individual' | 'business';

export type TenantShape = Pick<
  TenantInterface,
  '_id' | 'primaryUserId' | 'type' | 'name' | 'currency' | 'budgetLimit' | 'notificationsEnabled' | 'emailSyncEnabled'
>;

export type UserShape = Pick<UserInterface, '_id' | 'email' | 'displayName'>;

export interface TenantMemberDTO {
  id: string;
  email: string;
  displayName?: string;
  isPrimary: boolean;
}

export interface TenantDTO {
  id: string;
  type: TenantType;
  name?: string;
  primaryUserId: string;
  currency: string;
  budgetLimit: number;
  notificationsEnabled: boolean;
  emailSyncEnabled: boolean;
  members: TenantMemberDTO[];
}

export interface UpdateTenantInput {
  name?: string;
  type?: TenantType;
  currency?: string;
  budgetLimit?: number;
  notificationsEnabled?: boolean;
  emailSyncEnabled?: boolean;
}

export interface AddMemberInput {
  email: string;
}
