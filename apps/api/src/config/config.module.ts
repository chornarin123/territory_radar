import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.service.js';
import { validateEnv } from './env.js';

/**
 * One `.env`, in `apps/api`, shared by the API and the worker: they talk to the
 * same database with the same budget and the same kill switch, and two copies
 * would drift. It is resolved from this file rather than the working directory
 * so `node apps/worker/dist/main.js` finds it from anywhere; a `.env` in the
 * working directory still wins, which is how a deployment overrides it.
 */
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [resolve(process.cwd(), '.env'), resolve(API_ROOT, '.env')],
      validate: validateEnv,
      cache: true,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
