export interface AlertDTO {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  created_at: Date;
}

export interface CreateAlertInput {
  kind: string;
  title: string;
  body: string;
}
