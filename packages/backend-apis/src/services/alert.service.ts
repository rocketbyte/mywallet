import { Alert } from '../../../temporal-workflows/src/models';

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

function toDTO(doc: any): AlertDTO {
  return {
    id: doc._id.toString(),
    user_id: doc.userId,
    kind: doc.kind,
    title: doc.title,
    body: doc.body,
    read: doc.read,
    created_at: doc.createdAt,
  };
}

export class AlertService {
  async list(userId: string): Promise<AlertDTO[]> {
    const docs = await Alert.find({ userId }).sort({ createdAt: -1 }).lean();
    return docs.map(toDTO);
  }

  async create(userId: string, input: CreateAlertInput): Promise<AlertDTO> {
    const doc = await Alert.create({ userId, ...input });
    return toDTO(doc.toObject());
  }

  async markRead(userId: string, id: string): Promise<AlertDTO | null> {
    const doc = await Alert.findOneAndUpdate({ _id: id, userId }, { $set: { read: true } }, { new: true }).lean();
    return doc ? toDTO(doc) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await Alert.findOneAndDelete({ _id: id, userId });
    return result !== null;
  }
}
