import { Alert } from '../../../temporal-workflows/src/models';
import type { AlertDTO, CreateAlertInput } from '../types/alert.types';

function toDTO(doc: any): AlertDTO {
  return {
    id: doc._id.toString(),
    userId: doc.userId,
    kind: doc.kind,
    title: doc.title,
    body: doc.body,
    read: doc.read,
    readAt: doc.readAt,
    createdAt: doc.createdAt,
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
    // Set read + readAt only on the first transition, so re-marking an
    // already-read alert is idempotent and does not advance readAt.
    const transitioned = await Alert.findOneAndUpdate(
      { _id: id, userId, read: false },
      { $set: { read: true, readAt: new Date() } },
      { new: true },
    ).lean();
    if (transitioned) return toDTO(transitioned);

    // Already read (idempotent success) or not found.
    const existing = await Alert.findOne({ _id: id, userId }).lean();
    return existing ? toDTO(existing) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await Alert.findOneAndDelete({ _id: id, userId });
    return result !== null;
  }
}
