export interface AlertDTO {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

export interface CreateAlertInput {
  kind: string;
  title: string;
  body: string;
}
