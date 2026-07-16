import { WatchedSender } from '../../../temporal-workflows/src/models';
import { normalizeSenderEntry } from '../../../temporal-workflows/src/shared/sender-match';
import type { WatchedSenderKind, WatchedSenderSource } from '../../../temporal-workflows/src/models';

export interface WatchedSenderDTO {
  id: string;
  value: string;
  kind: WatchedSenderKind;
  source: WatchedSenderSource;
  createdAt: Date;
}

/** Caller-suppliable sources; `backfill` is reserved for the backfill script. */
export type CallerSenderSource = Extract<WatchedSenderSource, 'manual' | 'onboarding'>;

function toDTO(doc: any): WatchedSenderDTO {
  return {
    id: doc._id.toString(),
    value: doc.value,
    kind: doc.kind,
    source: doc.source,
    createdAt: doc.createdAt,
  };
}

export class SenderService {
  async list(userId: string): Promise<WatchedSenderDTO[]> {
    const rows = await WatchedSender.find({ userId }).sort({ value: 1 }).lean();
    return rows.map(toDTO);
  }

  /**
   * Adds a watched sender for the tenant. Input is normalized (lowercase, bare
   * address/domain); adding a value the tenant already watches is idempotent —
   * the existing entry is returned unchanged (`$setOnInsert` upsert, so there
   * is no duplicate-key race). Returns null for input that is neither a
   * plausible address nor a plausible domain.
   */
  async add(
    userId: string,
    rawValue: string,
    source: CallerSenderSource = 'manual',
  ): Promise<WatchedSenderDTO | null> {
    const entry = normalizeSenderEntry(rawValue);
    if (!entry) return null;

    const doc = await WatchedSender.findOneAndUpdate(
      { userId, value: entry.value },
      { $setOnInsert: { userId, value: entry.value, kind: entry.kind, source } },
      { new: true, upsert: true },
    ).lean();
    return toDTO(doc);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    try {
      const result = await WatchedSender.findOneAndDelete({ _id: id, userId });
      return result !== null;
    } catch (error) {
      // Malformed ids (CastError) mean the entry can't exist for this caller.
      if ((error as { name?: string })?.name === 'CastError') return false;
      throw error;
    }
  }
}
