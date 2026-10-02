import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'nitro build apps/api',
        cwd: '../..',
        cache: {
          env: ['NODE_ENV', 'NITRO_PRESET'],
          input: [
            { pattern: 'apps/api/**', base: 'workspace' },
            { pattern: 'drizzle/*.ts', base: 'workspace' },
            { pattern: 'pnpm-lock.yaml', base: 'workspace' },
          ],
          output: [{ pattern: 'dist/apps/api/**', base: 'workspace' }],
        },
      },
    },
  },
});
