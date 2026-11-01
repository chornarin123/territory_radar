import { Module } from '@nestjs/common';
import { ScanModule, SignalsModule } from '@territory-radar/api';
import { ScanWorkers } from './scan.workers.js';

/** The queue handlers. Loaded by the worker service, never by the CLI. */
@Module({
  imports: [ScanModule, SignalsModule],
  providers: [ScanWorkers],
})
export class ScanWorkersModule {}
