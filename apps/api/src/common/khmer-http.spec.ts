import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

// NestJS's FastifyAdapter sends controller return values through Fastify's
// default JSON serialisation. This pins that path: if someone adds a custom
// serializer or a content type that drops UTF-8, Khmer breaks before it ever
// reaches the Expo app — and this test fails first.

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const BODY = {
  summaryKm: 'ហាងនេះមានអតិថិជនច្រើន ប៉ុន្តែទំនិញខ្លះអស់ពីស្តុក។',
  stack: 'ស្ត្រី',
  phnomPenh: `ភ្នំ${ZERO_WIDTH_SPACE}ពេញ`,
};

async function serve() {
  const app = Fastify();
  app.get('/lead', async () => BODY);
  const response = await app.inject({ method: 'GET', url: '/lead' });
  await app.close();
  return response;
}

describe('Khmer over HTTP', () => {
  it('declares utf-8 explicitly, so no client has to guess the encoding', async () => {
    const response = await serve();
    expect(response.headers['content-type']).toMatch(/^application\/json; charset=utf-8$/i);
  });

  it('sends Khmer byte-for-byte', async () => {
    const response = await serve();
    expect(response.rawPayload.equals(Buffer.from(JSON.stringify(BODY), 'utf8'))).toBe(true);
    expect(response.json()).toEqual(BODY);
  });

  it('keeps Khmer as UTF-8 rather than escaping it, which would triple the payload', async () => {
    const response = await serve();
    expect(response.payload).toContain(BODY.summaryKm);
    expect(response.payload.includes(String.fromCharCode(92) + 'u17')).toBe(false);
  });
});
