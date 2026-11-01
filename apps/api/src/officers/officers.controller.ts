import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { OfficerDto } from '@territory-radar/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OfficersService } from './officers.service.js';

const officerSchema = z.object({
  name: z.string().min(1).max(200),
  branch: z.string().min(1).max(200),
  assignedSangkats: z.array(z.string().min(1)).default([]),
});

const officerPatchSchema = officerSchema.partial();

@Controller('officers')
export class OfficersController {
  constructor(private readonly officers: OfficersService) {}

  @Get()
  list(): Promise<OfficerDto[]> {
    return this.officers.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(officerSchema)) body: z.infer<typeof officerSchema>,
  ): Promise<OfficerDto> {
    return this.officers.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(officerPatchSchema)) body: z.infer<typeof officerPatchSchema>,
  ): Promise<OfficerDto> {
    return this.officers.update(id, body);
  }
}
