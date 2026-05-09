export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ConnectInput {
  email: string;
  provider: string;
}

export interface MeDTO {
  id: string;
  email: string;
  display_name?: string;
  email_verified: boolean;
  provider: string;
  identities: { provider: string; subject: string; linked_at?: Date }[];
  last_login_at?: Date;
  created_at: Date;
}
