import { defineConfig } from 'vite-plus';

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
    include: ['apps/api/**/*.test.ts', 'drizzle/**/*.test.ts'],
    environment: 'node',
  },
});
