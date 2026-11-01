import { Module } from '@nestjs/common';
import { OfficersController } from './officers.controller.js';
import { OfficersService } from './officers.service.js';

@Module({
  controllers: [OfficersController],
  providers: [OfficersService],
  exports: [OfficersService],
})
export class OfficersModule {}
