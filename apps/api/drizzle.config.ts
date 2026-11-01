import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  // Only `db:migrate` / `db:studio` need a connection; `db:generate` works offline.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
});
