import { Inject, Injectable } from '@nestjs/common';
import type { SignalType } from '@territory-radar/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { daysAgo } from '../common/time.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { signals } from '../database/schema.js';
import type { DetectedSignal } from './detectors.js';

/** Do not raise the same signal for the same place more than once a week. */
export const SIGNAL_DEDUPE_DAYS = 7;

@Injectable()
export class SignalsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Writes a signal unless the same type fired for this place in the last week. */
  async record(placeId: string, signal: DetectedSignal, at: Date): Promise<boolean> {
    if (await this.recentlyRaised(placeId, signal.type, at)) return false;
    await this.db.insert(signals).values({
      placeId,
      detectedAt: at,
      signalType: signal.type,
      evidence: signal.evidence,
      confidence: signal.confidence,
    });
    return true;
  }

  private async recentlyRaised(placeId: string, type: SignalType, at: Date): Promise<boolean> {
    const [existing] = await this.db
      .select({ one: sql<number>`1` })
      .from(signals)
      .where(
        and(
          eq(signals.placeId, placeId),
          eq(signals.signalType, type),
          gte(signals.detectedAt, daysAgo(at, SIGNAL_DEDUPE_DAYS)),
        ),
      )
      .orderBy(desc(signals.detectedAt))
      .limit(1);
    return existing !== undefined;
  }
}
