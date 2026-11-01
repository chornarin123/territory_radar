import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { LEAD_STATUSES } from '@territory-radar/shared';
import type { LeadDto, LeadFeedbackRequest } from '@territory-radar/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadsService } from './leads.service.js';

const feedbackSchema = z
  .object({
    // Every lead status except "new" — that one is set by the assignment job.
    status: z.enum(LEAD_STATUSES).exclude(['new']),
    outcomeNote: z.string().max(2000).optional(),
    revisitAfter: z.iso.date().optional(),
  })
  .refine((body) => body.status !== 'revisit' || body.revisitAfter !== undefined, {
    message: 'revisitAfter is required when status is "revisit"',
    path: ['revisitAfter'],
  });

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** An officer's open leads, best first. */
  @Get()
  async list(@Query('officerId') officerId?: string): Promise<LeadDto[]> {
    if (!officerId) throw new BadRequestException('officerId is required');
    return this.leads.listForOfficer(officerId);
  }

  @Patch(':id')
  async feedback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(feedbackSchema)) body: LeadFeedbackRequest,
  ): Promise<LeadDto> {
    return this.leads.recordFeedback(id, body);
  }
}
