import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'ng build app --configuration=production',
        cache: {
          env: ['NODE_ENV'],
          input: [
            { pattern: 'tsconfig.base.json', base: 'workspace' },
            { pattern: 'apps/app/**', base: 'workspace' },
            { pattern: '!apps/app/**/node_modules/**', base: 'workspace' },
            { pattern: '!apps/app/.angular/**', base: 'workspace' },
            { pattern: 'apps/api/server/**', base: 'workspace' },
            { pattern: 'apps/api/shared/**', base: 'workspace' },
            { pattern: 'drizzle/*.ts', base: 'workspace' },
            { pattern: 'pnpm-lock.yaml', base: 'workspace' },
          ],
          output: [{ pattern: 'dist/apps/app/**', base: 'workspace' }],
        },
      },
    },
  },
});
