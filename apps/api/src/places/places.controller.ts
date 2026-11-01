import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { LivePlaceDetails } from '@territory-radar/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { KillSwitchError } from '../usage/usage.service.js';
import { GooglePlacesClient } from './google-places.client.js';
import { DEFAULT_SEED_RADIUS_M, GridSeedService } from './grid-seed.service.js';
import { MIN_RADIUS_M } from './grid.js';

const seedSchema = z.object({
  sangkatCode: z.string().min(1),
  bbox: z.object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  }),
  radiusM: z.int().min(MIN_RADIUS_M).max(5000).default(DEFAULT_SEED_RADIUS_M),
});

@Controller('places')
export class PlacesController {
  constructor(
    private readonly client: GooglePlacesClient,
    private readonly gridSeed: GridSeedService,
  ) {}

  /**
   * Name, address and phone for one place, fetched from Google on every request.
   * This is the only place business identity is exposed, and it is never stored —
   * see the retention note in database/schema.ts.
   */
  @Get(':placeId/live')
  @Header('Cache-Control', 'no-store')
  async live(@Param('placeId') placeId: string): Promise<LivePlaceDetails> {
    try {
      const details = await this.client.fetchLiveDetails(placeId);
      return { placeId, ...details };
    } catch (err) {
      if (err instanceof KillSwitchError) {
        throw new ServiceUnavailableException('Live place lookups are disabled (KILL_SWITCH)');
      }
      throw err;
    }
  }

  /** Lays the initial scan grid over a sangkat. Run once per area — see scripts/seed-grid.mjs. */
  @Post('grid')
  async seedGrid(
    @Body(new ZodValidationPipe(seedSchema)) body: z.infer<typeof seedSchema>,
  ): Promise<{ cells: number }> {
    return { cells: await this.gridSeed.seed(body.sangkatCode, body.bbox, body.radiusM) };
  }
}
