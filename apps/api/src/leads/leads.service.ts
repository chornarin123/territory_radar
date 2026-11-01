import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LeadDto, LeadFeedbackRequest } from '@territory-radar/shared';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/database.module.js';
import { leads, places, reviewAnalyses, scores } from '../database/schema.js';

// Assignment happens in the weekly scan.score run (scan/score.service.ts);
// this service only reads leads and records officer feedback.

const OPEN_STATUSES = ['new', 'visited', 'revisit'] as const;

@Injectable()
export class LeadsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listForOfficer(officerId: string): Promise<LeadDto[]> {
    const latest = this.db
      .select({ placeId: scores.placeId, lastDate: max(scores.scanDate).as('last_date') })
      .from(scores)
      .groupBy(scores.placeId)
      .as('latest');

    const rows = await this.db
      .select({
        lead: leads,
        place: places,
        score: scores,
        analysis: reviewAnalyses,
      })
      .from(leads)
      .innerJoin(places, eq(places.placeId, leads.placeId))
      .leftJoin(reviewAnalyses, eq(reviewAnalyses.placeId, leads.placeId))
      .leftJoin(latest, eq(latest.placeId, leads.placeId))
      .leftJoin(
        scores,
        and(eq(scores.placeId, leads.placeId), eq(scores.scanDate, latest.lastDate)),
      )
      .where(and(eq(leads.officerId, officerId), inArray(leads.status, [...OPEN_STATUSES])))
      .orderBy(asc(leads.routeId), asc(leads.routePosition), desc(scores.total));

    return rows.map(({ lead, place, score, analysis }) => ({
      id: lead.id,
      placeId: lead.placeId,
      officerId: lead.officerId,
      status: lead.status,
      assignedAt: lead.assignedAt.toISOString(),
      revisitAfter: lead.revisitAfter,
      outcomeNote: lead.outcomeNote,
      location:
        place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null,
      primaryType: place.primaryType,
      sangkatCode: place.sangkatCode,
      routeId: lead.routeId,
      routePosition: lead.routePosition,
      summaryKm: analysis?.summaryKm ?? null,
      businessScale: analysis?.businessScale ?? null,
      score: score
        ? {
            scanDate: score.scanDate,
            total: score.total,
            need: score.need,
            capacity: score.capacity,
            bankability: score.bankability,
            topFactors: score.topFactors,
          }
        : null,
    }));
  }

  /** Officer feedback. `outcomeNote` is stored as written and never sent to an AI tool. */
  async recordFeedback(id: string, feedback: LeadFeedbackRequest): Promise<LeadDto> {
    const [updated] = await this.db
      .update(leads)
      .set({
        status: feedback.status,
        outcomeNote: feedback.outcomeNote ?? null,
        revisitAfter: feedback.revisitAfter ?? null,
      })
      .where(eq(leads.id, id))
      .returning({ officerId: leads.officerId });

    if (!updated) throw new NotFoundException(`Lead ${id} not found`);
    const list = await this.listForOfficer(updated.officerId);
    const lead = list.find((l) => l.id === id);
    if (lead) return lead;

    // Closed leads drop out of the open list; return the stored row.
    const [row] = await this.db
      .select({ lead: leads, place: places })
      .from(leads)
      .innerJoin(places, eq(places.placeId, leads.placeId))
      .where(eq(leads.id, id));
    if (!row) throw new NotFoundException(`Lead ${id} not found`);
    return {
      id: row.lead.id,
      placeId: row.lead.placeId,
      officerId: row.lead.officerId,
      status: row.lead.status,
      assignedAt: row.lead.assignedAt.toISOString(),
      revisitAfter: row.lead.revisitAfter,
      outcomeNote: row.lead.outcomeNote,
      location:
        row.place.lat !== null && row.place.lng !== null
          ? { lat: row.place.lat, lng: row.place.lng }
          : null,
      primaryType: row.place.primaryType,
      sangkatCode: row.place.sangkatCode,
      routeId: row.lead.routeId,
      routePosition: row.lead.routePosition,
      summaryKm: null,
      businessScale: null,
      score: null,
    };
  }
}
