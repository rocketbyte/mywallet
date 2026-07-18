export interface AlertDTO {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
}

export interface CreateAlertInput {
  kind: string;
  title: string;
  body: string;
}
