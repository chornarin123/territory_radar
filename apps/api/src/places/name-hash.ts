import { createHash } from 'node:crypto';

/**
 * One-way hash of a business name, used to spot chains ("same name at three
 * addresses") without storing the name itself. Not reversible, so it stays on
 * the right side of the Places caching rules — see docs/data-policy.md.
 */
export function hashBusinessName(name: string | null): string | null {
  const normalised = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalised.length < 3) return null;
  return createHash('sha256').update(normalised).digest('hex').slice(0, 32);
}
