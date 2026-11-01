import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  AppConfig,
  BudgetExceededError,
  DiscoverService,
  EnrichService,
  JobRunTracker,
  KillSwitchError,
  RetentionService,
  ReviewMiningService,
  SCAN_CATEGORIES,
  ScanPipelineService,
  ScoreRunService,
  UsageService,
  jobError,
} from '@territory-radar/api';
import type { DiscoverCellJob } from '@territory-radar/api';
import { parseArgs } from './cli-args.js';
import type { CliArgs } from './cli-args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Imported only after the arguments are valid: loading PipelineModule runs
  // env validation, and a typo in a job name should not surface as an env error.
  const { PipelineModule } = await import('./pipeline.module.js');
  const app = await NestFactory.createApplicationContext(PipelineModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();
  const log = new Logger('cli');

  try {
    if (app.get(AppConfig).killSwitch && args.job !== 'retention') {
      log.warn('KILL_SWITCH is on — refusing to make outbound calls.');
      process.exitCode = 1;
      return;
    }

    if (args.queue) {
      const summary = await app.get(ScanPipelineService).start(args.job, args.sangkat);
      log.log(`Queued: ${JSON.stringify(summary)}`);
      log.log('The worker service will process it; watch GET /jobs/runs.');
      return;
    }

    const runs = app.get(JobRunTracker);
    const runId = await runs.start(args.job);
    log.log(`${args.job} run ${runId}${args.sangkat ? ` · sangkat ${args.sangkat}` : ''}`);

    try {
      switch (args.job) {
        case 'scan.discover':
          await runDiscover(
            app.get(DiscoverService),
            app.get(UsageService),
            runs,
            runId,
            args,
            log,
          );
          break;
        case 'scan.enrich':
          await runEnrich(
            app.get(EnrichService),
            app.get(UsageService),
            runs,
            runId,
            args,
            log,
            app.get(ReviewMiningService),
          );
          break;
        case 'scan.score': {
          const result = await app.get(ScoreRunService).run(new Date(), args.sangkat);
          await runs.record(runId, { items: result.itemsProcessed });
          for (const error of result.errors) await runs.addError(runId, error);
          log.log(
            `Scored ${result.scored} · ${result.routes} walking routes · ${result.leadsAssigned} leads assigned`,
          );
          break;
        }
        case 'retention': {
          const result = await app.get(RetentionService).run();
          await runs.record(runId, { items: result.itemsProcessed });
          log.log(`Cleared coordinates for ${result.itemsProcessed} places`);
          break;
        }
      }
    } catch (err) {
      await runs.addError(runId, jobError(err, { via: 'cli' }));
      throw err;
    } finally {
      await runs.finish(runId);
      log.log(`job_runs ${runId} closed`);
    }
  } finally {
    await app.close();
  }
}

/** Scans every leaf cell × category inline, following saturated cells into their children. */
async function runDiscover(
  discover: DiscoverService,
  usage: UsageService,
  runs: JobRunTracker,
  runId: string,
  args: CliArgs,
  log: Logger,
): Promise<void> {
  const cells = await discover.leafCells(args.sangkat);
  if (cells.length === 0) {
    log.warn(
      'No grid cells found. Seed the grid first: POST /places/grid or scripts/seed-grid.mjs',
    );
    return;
  }

  const pending: DiscoverCellJob[] = cells.flatMap((cell) =>
    SCAN_CATEGORIES.map((category) => ({ ...cell, runId, category })),
  );
  log.log(
    `${cells.length} cells × ${SCAN_CATEGORIES.length} categories = ${pending.length} searches`,
  );

  const totals = { searches: 0, results: 0, newPlaces: 0, openings: 0, saturated: 0 };

  while (pending.length > 0) {
    if (args.limit !== undefined && totals.searches >= args.limit) {
      log.warn(`--limit ${args.limit} reached; ${pending.length} searches not run`);
      break;
    }

    const job = pending.shift()!;
    const { result, error, apiCalls } = await usage.withRunCounter(() => discover.scanCell(job));
    await runs.record(runId, { items: result?.placesFound ?? 0, apiCalls });

    if (error) {
      await runs.addError(runId, jobError(error, { cellId: job.cellId, category: job.category }));
      if (error instanceof BudgetExceededError || error instanceof KillSwitchError) {
        log.warn(`Stopped: ${error.message}`);
        break;
      }
      log.error(`${job.category} @ ${job.cellId}: ${(error as Error).message}`);
      continue;
    }

    const r = result!;
    totals.searches += 1;
    totals.results += r.placesFound;
    totals.newPlaces += r.newPlaces;
    totals.openings += r.newOpenings;
    if (r.saturated) totals.saturated += 1;
    pending.push(...r.childJobs);

    const notes = [
      r.saturated ? `SATURATED → +${r.childJobs.length} child searches` : '',
      r.newOpenings > 0 ? `${r.newOpenings} new opening(s)` : '',
    ].filter(Boolean);
    log.log(
      `[${totals.searches}] ${job.category.padEnd(17)} ${String(job.radiusM).padStart(3)}m → ` +
        `${String(r.placesFound).padStart(2)} places${notes.length ? ` · ${notes.join(' · ')}` : ''}`,
    );
  }

  log.log(
    `Discover: ${totals.searches} searches · ${totals.results} results · ` +
      `${totals.newPlaces} new places · ${totals.openings} new openings · ${totals.saturated} saturated cells`,
  );
}

/** Enriches new places plus the rotation slice, inline, stopping cleanly on budget. */
async function runEnrich(
  enrich: EnrichService,
  usage: UsageService,
  runs: JobRunTracker,
  runId: string,
  args: CliArgs,
  log: Logger,
  mining: ReviewMiningService,
): Promise<void> {
  const targets = await enrich.selectTargets(args.sangkat);
  const batch = args.limit !== undefined ? targets.slice(0, args.limit) : targets;
  log.log(
    `${targets.length} places to enrich${batch.length < targets.length ? `, running ${batch.length} (--limit)` : ''}` +
      ` · ~$${(batch.length * 0.04).toFixed(2)} at Enterprise + Atmosphere list price`,
  );

  let enriched = 0;
  for (const placeId of batch) {
    const { result, error, apiCalls } = await usage.withRunCounter(() =>
      enrich.enrichPlace(runId, placeId),
    );
    await runs.record(runId, { items: result ? 1 : 0, apiCalls });

    if (error) {
      await runs.addError(runId, jobError(error, { placeId }));
      if (EnrichService.isFatal(error)) {
        log.warn(`Stopped: ${(error as Error).message}`);
        break;
      }
      log.error(`${placeId}: ${(error as Error).message}`);
      continue;
    }

    enriched += 1;
    const r = result!;
    const outcome = r.closed
      ? 'closed permanently'
      : r.signals.length
        ? r.signals.join(', ')
        : 'no signals';
    log.log(`[${enriched}/${batch.length}] ${placeId} → ${outcome}`);
  }

  await mining.drain();
  const m = mining.stats;
  log.log(
    `Reviews: ${m.analysed} analysed by Claude in ${m.calls} call(s) · ${m.unchanged} unchanged (cached) · ` +
      `${m.failed} skipped · ${m.signals} signals`,
  );

  const flagged = await enrich.refreshMultiBranchFlags();
  log.log(`Enrich: ${enriched} places · ${flagged} newly flagged multi-branch`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
