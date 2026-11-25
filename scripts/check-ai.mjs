/* global AbortSignal */
/**
 * Confirms the AI works on a running server before a demo.
 *
 *   node scripts/check-ai.mjs                                       # local, :3002
 *   node scripts/check-ai.mjs https://territory-radar-ndup.onrender.com
 *
 * Calls GET /health/ai, which sends one test prompt to the configured model.
 * Exits 0 when the model answered, 1 otherwise.
 */
const base = (process.argv[2] || 'http://localhost:3002').replace(/\/$/, '');

try {
  const res = await fetch(`${base}/health/ai`, { signal: AbortSignal.timeout(60_000) });
  const body = await res.json().catch(() => ({}));
  if (body.ok) {
    console.log(
      `AI OK · ${body.provider} ${body.model} · ${body.latencyMs} ms · reply "${body.reply}"`,
    );
    process.exit(0);
  }
  console.error(`AI NOT OK (HTTP ${res.status}) · ${body.provider ?? '?'} ${body.model ?? ''}`);
  console.error(
    `  ${body.error ?? 'no /health/ai on this server: is it deployed with the latest code?'}`,
  );
  process.exit(1);
} catch (err) {
  console.error(`Could not reach ${base}/health/ai: ${err.message}`);
  process.exit(1);
}
