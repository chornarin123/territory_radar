import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import type { SendOptions, WorkOptions } from 'pg-boss';
import { AppConfig } from '../config/app-config.service.js';
import { QUEUES } from './queue.constants.js';
import type { QueueName } from './queue.constants.js';

/**
 * The job queue, backed by the same Postgres database as everything else.
 *
 * pg-boss keeps its tables in a `pgboss` schema and creates them on start, so
 * there is no second service to run — see docs/queueing.md for why this was
 * chosen over Redis/BullMQ.
 */
@Injectable()
export class PgBossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  private readonly boss: PgBoss;
  private started = false;

  constructor(private readonly config: AppConfig) {
    this.boss = new PgBoss({
      connectionString: config.get('QUEUE_DATABASE_URL') ?? config.get('DATABASE_URL'),
      schema: 'pgboss',
      application_name: 'territory-radar',
      max: 4,
      // LISTEN/NOTIFY needs a session-pinned connection, which Neon's pooled
      // endpoint doesn't give us. Polling is the correctness floor anyway.
      useListenNotify: false,
    });

    this.boss.on('error', (err: Error) => this.logger.error(`pg-boss: ${err.message}`, err.stack));
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    for (const name of Object.values(QUEUES)) {
      await this.boss.createQueue(name, {
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        // A cell scan is one HTTP call; if it hasn't finished in 2 minutes it's stuck.
        expireInSeconds: 120,
        retentionSeconds: 7 * 24 * 60 * 60,
      });
    }
    this.started = true;
    this.logger.log(`Queues ready: ${Object.values(QUEUES).join(', ')}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, timeout: 30_000 });
    this.started = false;
  }

  async send(queue: QueueName, data: object, options: SendOptions = {}): Promise<void> {
    await this.boss.send(queue, data, options);
  }

  /** Enqueues a batch in one round trip — a fan-out can be thousands of jobs. */
  async sendMany(queue: QueueName, jobs: object[]): Promise<number> {
    if (jobs.length === 0) return 0;
    await this.boss.insert(
      queue,
      jobs.map((data) => ({ data })),
    );
    return jobs.length;
  }

  async sendAfter(
    queue: QueueName,
    data: object,
    seconds: number,
    options: SendOptions = {},
  ): Promise<void> {
    await this.boss.sendAfter(queue, data, options, seconds);
  }

  /** Registers a handler. Jobs arrive in batches; we process them one at a time. */
  async work<T extends object>(
    queue: QueueName,
    handler: (data: T) => Promise<void>,
    options: WorkOptions = {},
  ): Promise<void> {
    await this.boss.work<T>(
      queue,
      {
        batchSize: 1,
        localConcurrency: this.config.get('SCAN_CONCURRENCY'),
        pollingIntervalSeconds: 2,
        ...options,
      },
      async (jobs) => {
        for (const job of jobs) await handler(job.data);
      },
    );
  }

  /** Jobs waiting or running — how a fan-out knows it has drained. */
  async depth(queue: QueueName): Promise<number> {
    const stats = await this.boss.getQueue(queue);
    if (!stats) return 0;
    return stats.queuedCount + stats.activeCount;
  }
}
