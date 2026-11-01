import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, isNotNull, lt } from 'drizzle-orm';
import type { JobResult } from '../common/job-result.js';
import { daysAgo } from '../common/time.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { places } from '../database/schema.js';

/**
 * Google Maps Platform Service Specific Terms §14.3 allow caching Places
 * latitude/longitude for at most 30 consecutive calendar days. Scans refresh
 * coordinates for everything still trading, so this only clears places we
 * haven't seen in a month. Everything else we keep is a place_id or our own
 * derived data, which has no time limit.
 */
export const COORDINATE_RETENTION_DAYS = 30;

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async run(now = new Date()): Promise<JobResult> {
    const expired = await this.db
      .update(places)
      .set({ lat: null, lng: null })
      .where(
        and(lt(places.lastSeen, daysAgo(now, COORDINATE_RETENTION_DAYS)), isNotNull(places.lat)),
      )
      .returning({ placeId: places.placeId });

    if (expired.length > 0) {
      this.logger.log(`Cleared coordinates for ${expired.length} places past the 30-day window`);
    }
    return { itemsProcessed: expired.length, errors: [] };
  }
}
