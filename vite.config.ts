import { defineConfig } from 'vite-plus';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  fmt: {
    singleQuote: true,
    ignorePatterns: [
      'apps/app/**',
      'dist/**',
      'coverage/**',
      'drizzle/migrations/meta/**',
      'pnpm-lock.yaml',
      '.pnpm/**',
    ],
  },
  lint: {
    ignorePatterns: ['dist/**', 'coverage/**', 'apps/api/.output/**', '.pnpm/**'],
  },
  test: {
    // A premature database import must never fall back to the developer's .env database.
    env: { DATABASE_URL: `file:${join(tmpdir(), `senv-test-fallback-${process.pid}.sqlite`)}` },
    include: ['apps/api/**/*.test.ts', 'apps/cli/**/*.test.ts', 'drizzle/**/*.test.ts'],
    environment: 'node',
  },
});
