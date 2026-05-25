export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ConnectInput {
  email: string;
  provider: string;
}

export type UserRole = 'admin' | 'guest';

export interface MeDTO {
  id: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  provider: string;
  identities: { provider: string; subject: string; linkedAt?: Date }[];
  lastLoginAt?: Date;
  createdAt: Date;
  tenantId?: string;
  role: UserRole;
}
