import { Global, Module } from '@nestjs/common';
import { JobRunTracker } from './job-run-tracker.service.js';

@Global()
@Module({
  providers: [JobRunTracker],
  exports: [JobRunTracker],
})
export class CommonModule {}
