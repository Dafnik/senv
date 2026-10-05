import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    target: 'node24',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'senv.js' },
    rolldownOptions: {
      external: [
        'commander',
        'ink',
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'string-width',
        '@trpc/client',
        'superjson',
        'open',
        'ws',
        '@napi-rs/keyring',
        /^node:/,
      ],
      output: { banner: '#!/usr/bin/env node' },
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
