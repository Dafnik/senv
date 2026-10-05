import { defineConfig } from 'nitro';

export default defineConfig({
  serverDir: './server',
  output: {
    dir: '../../dist/apps/api',
  },
  traceDeps: ['better-sqlite3*'],
  features: { websocket: true },
  routes: {
    '/api/auth/**': './server/features/auth/auth.ts',
    '/api/trpc/**': './server/trpc/trpc-handler.ts',
  },
  // FIXME not working with runtime .env variables, compiled during build and needs to survive JSON
  // routeRules: {
  //   '/api/**': {
  //     cors: {
  //       origin: [process.env['APP_URL']!],
  //       credentials: true,
  //     },
  //   },
  // },
});
