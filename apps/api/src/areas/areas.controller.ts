import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AreasService } from './areas.service.js';
import type { Area } from './areas.service.js';

const areaSchema = z.object({
  sangkatCode: z.string().min(1).max(32),
  nameEn: z.string().min(1),
  nameKm: z.string().min(1),
  districtCode: z.string().min(1).max(32),
  provinceCode: z.string().min(1).max(32),
  households: z.int().nonnegative().nullish(),
  population: z.int().nonnegative().nullish(),
  /** Purchasing power index, already normalised to 0..1. */
  ppiScore: z.number().min(0).max(1).nullish(),
  ppiComponents: z.record(z.string(), z.number()).nullish(),
});

const importSchema = z.array(areaSchema).min(1).max(5000);

@Controller('areas')
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  @Get()
  list(@Query('provinceCode') provinceCode?: string): Promise<Area[]> {
    return this.areas.list(provinceCode);
  }

  @Get(':sangkatCode')
  get(@Param('sangkatCode') sangkatCode: string): Promise<Area> {
    return this.areas.get(sangkatCode);
  }

  /** Bulk import — see scripts/import-areas.mjs. */
  @Put()
  async import(
    @Body(new ZodValidationPipe(importSchema)) body: z.infer<typeof importSchema>,
  ): Promise<{ imported: number }> {
    return { imported: await this.areas.upsertMany(body) };
  }
}
