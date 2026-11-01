import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli-args.js';

describe('parseArgs', () => {
  it('reads the demo command', () => {
    expect(parseArgs(['run', 'scan.discover', '--sangkat=120101'])).toEqual({
      job: 'scan.discover',
      sangkat: '120101',
      limit: undefined,
      queue: false,
    });
  });

  it('ignores flags the Nest CLI puts in front of the job', () => {
    const args = parseArgs(['--entryFile=cli', 'run', 'scan.enrich', '--limit=5']);
    expect(args.job).toBe('scan.enrich');
    expect(args.limit).toBe(5);
  });

  it('accepts --queue as a bare flag', () => {
    expect(parseArgs(['run', 'scan.score', '--queue']).queue).toBe(true);
  });

  // A mistyped job on stage must fail before anything opens a connection.
  it.each([['run', 'scan.discovery'], ['scan.discover'], ['run']])(
    'rejects %j with usage',
    (...argv: string[]) => {
      expect(() => parseArgs(argv)).toThrow(/Usage: pnpm worker run/);
    },
  );

  it.each(['--limit=0', '--limit=2.5', '--limit=all'])('rejects %s', (flag) => {
    expect(() => parseArgs(['run', 'scan.enrich', flag])).toThrow(/positive integer/);
  });
});
