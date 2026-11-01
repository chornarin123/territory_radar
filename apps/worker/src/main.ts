import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfig } from '@territory-radar/api';
import { WorkerModule } from './worker.module.js';

/**
 * The worker has no HTTP port. It stays alive on pg-boss's polling timers and
 * the cron schedule, and exits when they are shut down — so a platform health
 * check should watch `job_runs` (or the API's `/health`), not a socket here.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  // Drains in-flight jobs and the pending review batch on SIGTERM.
  app.enableShutdownHooks();

  const logger = new Logger('Worker');
  logger.log('Worker started — queue handlers registered, cron schedule armed');
  logger.log(
    'Sun 22:00 scan.discover · Sun 23:00 scan.enrich · Sun 23:30 scan.score · 04:00 retention (Asia/Phnom_Penh)',
  );
  if (app.get(AppConfig).killSwitch) {
    logger.warn('KILL_SWITCH is ON — scheduled scans will be skipped and recorded as such');
  }
}

await bootstrap();
