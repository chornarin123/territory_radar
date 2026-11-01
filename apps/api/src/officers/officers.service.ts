import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OfficerDto } from '@territory-radar/shared';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { officers } from '../database/schema.js';

export interface OfficerInput {
  name: string;
  branch: string;
  assignedSangkats: string[];
}

@Injectable()
export class OfficersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<OfficerDto[]> {
    return this.db.select().from(officers).orderBy(asc(officers.name));
  }

  async create(input: OfficerInput): Promise<OfficerDto> {
    const [created] = await this.db.insert(officers).values(input).returning();
    return created!;
  }

  /** Territory changes take effect on the next assignment run. */
  async update(id: string, input: Partial<OfficerInput>): Promise<OfficerDto> {
    const [updated] = await this.db
      .update(officers)
      .set(input)
      .where(eq(officers.id, id))
      .returning();
    if (!updated) throw new NotFoundException(`Officer ${id} not found`);
    return updated;
  }
}
