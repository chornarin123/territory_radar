import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { gridCells } from '../database/schema.js';
import { seedCells } from './grid.js';
import type { BBox } from './grid.js';

/**
 * Starting radius for a seeded cell. 350m so that one subdivision gives
 * radius/√2 ≈ 250m children — four circles need at least radius/√2 each to
 * cover their parent without gaps.
 */
export const DEFAULT_SEED_RADIUS_M = 350;

@Injectable()
export class GridSeedService {
  private readonly logger = new Logger(GridSeedService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Lays a covering grid over a sangkat's bounding box. Circles overlap into
   * neighbouring sangkats, so a place is attributed to the sangkat of the cell
   * that found it first — see "Known limitations" in the README.
   */
  async seed(sangkatCode: string, bbox: BBox, radiusM = DEFAULT_SEED_RADIUS_M): Promise<number> {
    const [existing] = await this.db
      .select({ total: count() })
      .from(gridCells)
      .where(eq(gridCells.sangkatCode, sangkatCode));

    if ((existing?.total ?? 0) > 0) {
      throw new ConflictException(
        `${sangkatCode} already has ${existing?.total} grid cells. Delete them first to reseed.`,
      );
    }

    const circles = seedCells(bbox, radiusM);
    await this.db.insert(gridCells).values(
      circles.map((c) => ({
        sangkatCode,
        lat: c.lat,
        lng: c.lng,
        radiusM: Math.round(c.radiusM),
      })),
    );

    this.logger.log(`Seeded ${circles.length} cells of ${radiusM}m for ${sangkatCode}`);
    return circles.length;
  }
}
