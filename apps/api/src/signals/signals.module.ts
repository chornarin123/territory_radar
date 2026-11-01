import { Module } from '@nestjs/common';
import { ReviewMiningService } from './review-mining/review-mining.service.js';
import { SignalsService } from './signals.service.js';

@Module({
  providers: [SignalsService, ReviewMiningService],
  exports: [SignalsService, ReviewMiningService],
})
export class SignalsModule {}
