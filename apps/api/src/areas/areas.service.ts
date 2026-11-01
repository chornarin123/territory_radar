import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { areas } from '../database/schema.js';

export interface AreaInput {
  sangkatCode: string;
  nameEn: string;
  nameKm: string;
  districtCode: string;
  provinceCode: string;
  households?: number | null;
  population?: number | null;
  ppiScore?: number | null;
  ppiComponents?: Record<string, number> | null;
}

export type Area = typeof areas.$inferSelect;

@Injectable()
export class AreasService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(provinceCode?: string): Promise<Area[]> {
    const query = this.db.select().from(areas).orderBy(asc(areas.sangkatCode));
    return provinceCode ? query.where(eq(areas.provinceCode, provinceCode)) : query;
  }

  async get(sangkatCode: string): Promise<Area> {
    const [area] = await this.db.select().from(areas).where(eq(areas.sangkatCode, sangkatCode));
    if (!area) throw new NotFoundException(`Area ${sangkatCode} not found`);
    return area;
  }

  /** Bulk import of census and purchasing-power data; existing rows are replaced. */
  async upsertMany(input: AreaInput[], now = new Date()): Promise<number> {
    if (input.length === 0) return 0;
    const rows = input.map((area) => ({
      ...area,
      households: area.households ?? null,
      population: area.population ?? null,
      ppiScore: area.ppiScore ?? null,
      ppiComponents: area.ppiComponents ?? null,
      updatedAt: now,
    }));

    await this.db
      .insert(areas)
      .values(rows)
      .onConflictDoUpdate({
        target: areas.sangkatCode,
        set: {
          nameEn: sqlExcluded('name_en'),
          nameKm: sqlExcluded('name_km'),
          districtCode: sqlExcluded('district_code'),
          provinceCode: sqlExcluded('province_code'),
          households: sqlExcluded('households'),
          population: sqlExcluded('population'),
          ppiScore: sqlExcluded('ppi_score'),
          ppiComponents: sqlExcluded('ppi_components'),
          updatedAt: sqlExcluded('updated_at'),
        },
      });
    return rows.length;
  }
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
