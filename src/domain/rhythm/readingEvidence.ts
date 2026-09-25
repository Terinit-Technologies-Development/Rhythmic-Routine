import RhythmDeviceModule, {
  NativeDailyReadingEvidence,
} from '../../../modules/rhythm-device';
import { isValidLocalDateKey } from './attentionExchange';

export interface ReadingEvidenceSnapshot {
  dateKey: string;
  providerAvailable: boolean;
  protocolCompatible: boolean;
  verifiedActiveSeconds: number;
  qualifiedPages: number;
  readerUpdatedAtEpochMs?: number;
  syncedAtEpochMs: number;
}

export interface DailyReadingEvidenceClient {
  query(dateKey: string): Promise<ReadingEvidenceSnapshot>;
}

export interface DailyReadingEvidenceBridge {
  queryDailyReadingEvidence(dateKey: string): Promise<NativeDailyReadingEvidence>;
}

export class NativeDailyReadingEvidenceClient implements DailyReadingEvidenceClient {
  constructor(
    private readonly bridge: DailyReadingEvidenceBridge = RhythmDeviceModule,
    private readonly now: () => number = Date.now
  ) {}

  async query(dateKey: string): Promise<ReadingEvidenceSnapshot> {
    const syncedAtEpochMs = this.now();
    if (!isValidLocalDateKey(dateKey)) {
      return unavailableEvidence(dateKey, syncedAtEpochMs);
    }

    try {
      const raw = await this.bridge.queryDailyReadingEvidence(dateKey);
      if (!raw?.providerAvailable) {
        return unavailableEvidence(dateKey, this.now());
      }

      const compatible = Boolean(
        raw.protocolCompatible &&
          raw.protocolVersion === 2 &&
          raw.dateKey === dateKey &&
          isFiniteNonNegative(raw.verifiedActiveSeconds) &&
          Number.isInteger(raw.qualifiedPages) &&
          raw.qualifiedPages >= 0 &&
          isFiniteNonNegative(raw.updatedAtEpochMs)
      );

      if (!compatible) {
        return {
          dateKey,
          providerAvailable: true,
          protocolCompatible: false,
          verifiedActiveSeconds: 0,
          qualifiedPages: 0,
          readerUpdatedAtEpochMs: raw.updatedAtEpochMs >= 0 ? raw.updatedAtEpochMs : undefined,
          syncedAtEpochMs: this.now(),
        };
      }

      return {
        dateKey,
        providerAvailable: true,
        protocolCompatible: true,
        verifiedActiveSeconds: raw.verifiedActiveSeconds,
        qualifiedPages: raw.qualifiedPages,
        readerUpdatedAtEpochMs: raw.updatedAtEpochMs,
        syncedAtEpochMs: this.now(),
      };
    } catch {
      return unavailableEvidence(dateKey, this.now());
    }
  }
}

function unavailableEvidence(dateKey: string, syncedAtEpochMs: number): ReadingEvidenceSnapshot {
  return {
    dateKey,
    providerAvailable: false,
    protocolCompatible: false,
    verifiedActiveSeconds: 0,
    qualifiedPages: 0,
    syncedAtEpochMs,
  };
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
